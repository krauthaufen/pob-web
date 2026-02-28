/*
 * bridge.c - JS ↔ Lua bridge for PoB-web
 *
 * Provides functions exported to JavaScript via Emscripten for:
 * - Creating/destroying a Lua state
 * - Executing Lua code strings
 * - Loading and running Lua files
 * - Calling Lua functions and getting results
 */

#include <emscripten.h>
#include <string.h>
#include <stdlib.h>
#include <zlib.h>

#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"

static lua_State *L = NULL;

/* Custom print function that calls JS console.log */
EM_JS(void, js_console_log, (const char *msg), {
    console.log("[Lua]", UTF8ToString(msg));
});

static int lua_print_override(lua_State *L) {
    int n = lua_gettop(L);
    luaL_Buffer b;
    luaL_buffinit(L, &b);
    for (int i = 1; i <= n; i++) {
        if (i > 1) luaL_addchar(&b, '\t');
        const char *s = luaL_tolstring(L, i, NULL);
        luaL_addstring(&b, s);
        lua_pop(L, 1); /* pop the string from luaL_tolstring */
    }
    luaL_pushresult(&b);
    js_console_log(lua_tostring(L, -1));
    lua_pop(L, 1);
    return 0;
}

/* Lua-callable Deflate: compress a string with raw deflate (no header) */
static int lua_deflate(lua_State *L) {
    size_t srcLen;
    const char *src = luaL_checklstring(L, 1, &srcLen);

    uLongf destLen = compressBound(srcLen);
    unsigned char *dest = malloc(destLen);
    if (!dest) return luaL_error(L, "Deflate: malloc failed");

    z_stream strm;
    memset(&strm, 0, sizeof(strm));
    /* windowBits = -15 for raw deflate (no zlib/gzip header) */
    if (deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY) != Z_OK) {
        free(dest);
        return luaL_error(L, "Deflate: init failed");
    }

    strm.next_in = (unsigned char *)src;
    strm.avail_in = srcLen;
    strm.next_out = dest;
    strm.avail_out = destLen;

    int ret = deflate(&strm, Z_FINISH);
    destLen = strm.total_out;
    deflateEnd(&strm);

    if (ret != Z_STREAM_END) {
        free(dest);
        return luaL_error(L, "Deflate: compression failed");
    }

    lua_pushlstring(L, (const char *)dest, destLen);
    free(dest);
    return 1;
}

/* Lua-callable Inflate: decompress a raw-deflated string */
static int lua_inflate(lua_State *L) {
    size_t srcLen;
    const char *src = luaL_checklstring(L, 1, &srcLen);

    /* Start with 4x source size, grow if needed */
    uLongf destLen = srcLen * 4;
    if (destLen < 4096) destLen = 4096;
    unsigned char *dest = NULL;

    z_stream strm;
    memset(&strm, 0, sizeof(strm));
    /* windowBits = -15 for raw inflate */
    if (inflateInit2(&strm, -15) != Z_OK) {
        return luaL_error(L, "Inflate: init failed");
    }

    strm.next_in = (unsigned char *)src;
    strm.avail_in = srcLen;

    int ret;
    do {
        destLen *= 2;
        unsigned char *newDest = realloc(dest, destLen);
        if (!newDest) {
            free(dest);
            inflateEnd(&strm);
            return luaL_error(L, "Inflate: realloc failed");
        }
        dest = newDest;
        strm.next_out = dest + strm.total_out;
        strm.avail_out = destLen - strm.total_out;
        ret = inflate(&strm, Z_NO_FLUSH);
    } while (ret == Z_OK || ret == Z_BUF_ERROR);

    if (ret != Z_STREAM_END) {
        free(dest);
        inflateEnd(&strm);
        return luaL_error(L, "Inflate: decompression failed (%d)", ret);
    }

    lua_pushlstring(L, (const char *)dest, strm.total_out);
    free(dest);
    inflateEnd(&strm);
    return 1;
}

/* Lua-callable GetTime: return ms since epoch via emscripten */
static int lua_gettime(lua_State *L) {
    double ms = emscripten_get_now();
    lua_pushnumber(L, ms);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int bridge_init(void) {
    if (L) return 0; /* already initialized */

    L = luaL_newstate();
    if (!L) return -1;

    luaL_openlibs(L);

    /* Override print */
    lua_pushcfunction(L, lua_print_override);
    lua_setglobal(L, "print");

    /* Register Deflate/Inflate as Lua globals */
    lua_pushcfunction(L, lua_deflate);
    lua_setglobal(L, "Deflate");
    lua_pushcfunction(L, lua_inflate);
    lua_setglobal(L, "Inflate");

    /* Register GetTime that returns real ms */
    lua_pushcfunction(L, lua_gettime);
    lua_setglobal(L, "GetTime");

    return 0;
}

EMSCRIPTEN_KEEPALIVE
void bridge_destroy(void) {
    if (L) {
        lua_close(L);
        L = NULL;
    }
}

EMSCRIPTEN_KEEPALIVE
lua_State *bridge_get_state(void) {
    return L;
}

/* Execute a Lua string. Returns 0 on success, error string on failure. */
EMSCRIPTEN_KEEPALIVE
const char *bridge_exec(const char *code) {
    if (!L) return "Lua state not initialized";

    int status = luaL_dostring(L, code);
    if (status != 0) {
        const char *err = lua_tostring(L, -1);
        return err ? err : "Unknown Lua error";
    }
    return NULL; /* success */
}

/* Load and execute a Lua file. Returns 0 on success. */
EMSCRIPTEN_KEEPALIVE
const char *bridge_dofile(const char *path) {
    if (!L) return "Lua state not initialized";

    int status = luaL_dofile(L, path);
    if (status != 0) {
        const char *err = lua_tostring(L, -1);
        return err ? err : "Unknown Lua error";
    }
    return NULL;
}

/* Set a global string variable */
EMSCRIPTEN_KEEPALIVE
void bridge_set_string(const char *name, const char *value) {
    if (!L) return;
    lua_pushstring(L, value);
    lua_setglobal(L, name);
}

/* Set a global number variable */
EMSCRIPTEN_KEEPALIVE
void bridge_set_number(const char *name, double value) {
    if (!L) return;
    lua_pushnumber(L, value);
    lua_setglobal(L, name);
}

/* Get a global string variable. Returns NULL if not a string. */
EMSCRIPTEN_KEEPALIVE
const char *bridge_get_string(const char *name) {
    if (!L) return NULL;
    lua_getglobal(L, name);
    const char *result = lua_tostring(L, -1);
    lua_pop(L, 1);
    return result;
}

/* Get a global number variable. Returns 0 if not a number. */
EMSCRIPTEN_KEEPALIVE
double bridge_get_number(const char *name) {
    if (!L) return 0;
    lua_getglobal(L, name);
    double result = lua_tonumber(L, -1);
    lua_pop(L, 1);
    return result;
}

/*
 * Call a Lua function by name with a single JSON string argument.
 * Returns the result as a string (the Lua function should return a string/JSON).
 * The returned pointer is valid until the next call to bridge_call_json.
 */
static char *call_json_buf = NULL;
static size_t call_json_buf_size = 0;

EMSCRIPTEN_KEEPALIVE
const char *bridge_call_json(const char *func_name, const char *json_arg) {
    if (!L) return "{\"error\":\"Lua state not initialized\"}";

    int top = lua_gettop(L);

    lua_getglobal(L, func_name);
    if (!lua_isfunction(L, -1)) {
        lua_settop(L, top);
        return "{\"error\":\"Function not found\"}";
    }

    lua_pushstring(L, json_arg);
    int status = lua_pcall(L, 1, 1, 0);

    const char *result;
    if (status != 0) {
        const char *err = lua_tostring(L, -1);
        result = err ? err : "{\"error\":\"Unknown Lua error\"}";
    } else {
        result = lua_tostring(L, -1);
        if (!result) result = "null";
    }

    /* Copy result to our buffer so we can pop the stack */
    size_t len = strlen(result) + 1;
    if (len > call_json_buf_size) {
        free(call_json_buf);
        call_json_buf_size = len > 4096 ? len : 4096;
        call_json_buf = malloc(call_json_buf_size);
    }
    memcpy(call_json_buf, result, len);

    lua_settop(L, top); /* restore stack */
    return call_json_buf;
}

/* Get the top of the Lua stack (for debugging) */
EMSCRIPTEN_KEEPALIVE
int bridge_stack_top(void) {
    return L ? lua_gettop(L) : 0;
}

/* Clear the Lua stack */
EMSCRIPTEN_KEEPALIVE
void bridge_stack_clear(void) {
    if (L) lua_settop(L, 0);
}
