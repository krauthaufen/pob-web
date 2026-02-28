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

EMSCRIPTEN_KEEPALIVE
int bridge_init(void) {
    if (L) return 0; /* already initialized */

    L = luaL_newstate();
    if (!L) return -1;

    luaL_openlibs(L);

    /* Override print */
    lua_pushcfunction(L, lua_print_override);
    lua_setglobal(L, "print");

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
 */
EMSCRIPTEN_KEEPALIVE
const char *bridge_call_json(const char *func_name, const char *json_arg) {
    if (!L) return "{\"error\":\"Lua state not initialized\"}";

    lua_getglobal(L, func_name);
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 1);
        return "{\"error\":\"Function not found\"}";
    }

    lua_pushstring(L, json_arg);
    int status = lua_pcall(L, 1, 1, 0);
    if (status != 0) {
        const char *err = lua_tostring(L, -1);
        /* We need to keep the error string alive, so don't pop yet.
           The caller should be aware this string lives on the Lua stack. */
        return err ? err : "{\"error\":\"Unknown Lua error\"}";
    }

    const char *result = lua_tostring(L, -1);
    return result ? result : "null";
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
