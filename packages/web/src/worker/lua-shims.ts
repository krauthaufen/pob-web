/**
 * Lua compatibility shims for running LuaJIT-targeted PoB code in Lua 5.2.
 *
 * These are injected via bridge_exec() before loading HeadlessWrapper.
 */

/**
 * `bit` module shim: LuaJIT's bit library → Lua 5.2's bit32.
 *
 * Key differences:
 * - LuaJIT `bit` returns signed 32-bit values
 * - Lua 5.2 `bit32` returns unsigned 32-bit values
 * - `bit.tobit(x)` normalizes to signed 32-bit (no direct bit32 equivalent)
 * - `bit.bswap`, `bit.tohex` have no bit32 equivalents
 */
export const BIT_SHIM = `
bit = {}
bit.band = bit32.band
bit.bor = bit32.bor
bit.bxor = bit32.bxor
bit.lshift = bit32.lshift
bit.rshift = bit32.rshift
bit.arshift = bit32.arshift
bit.bnot = bit32.bnot

function bit.tobit(x)
  x = x % 4294967296  -- 2^32
  if x >= 2147483648 then  -- 2^31
    x = x - 4294967296
  end
  return x
end

function bit.bswap(x)
  x = bit32.band(x, 0xFFFFFFFF)
  local b0 = bit32.band(x, 0xFF)
  local b1 = bit32.band(bit32.rshift(x, 8), 0xFF)
  local b2 = bit32.band(bit32.rshift(x, 16), 0xFF)
  local b3 = bit32.band(bit32.rshift(x, 24), 0xFF)
  return bit.tobit(b0 * 16777216 + b1 * 65536 + b2 * 256 + b3)
end

function bit.tohex(x, n)
  n = n or 8
  if n < 0 then
    return string.format("%0" .. (-n) .. "X", bit32.band(x, 0xFFFFFFFF))
  end
  return string.format("%0" .. n .. "x", bit32.band(x, 0xFFFFFFFF))
end

function bit.rol(x, n)
  return bit32.lrotate(x, n)
end

function bit.ror(x, n)
  return bit32.rrotate(x, n)
end
`;

/**
 * `jit` global stub so Launch.lua line 17 doesn't crash:
 *   jit.opt.start('maxtrace=4000','maxmcode=8192')
 *
 * Also set `arg` to an empty table (Lua CLI sets this, but WASM doesn't).
 */
export const JIT_SHIM = `
jit = { opt = { start = function() end }, version = "pob-web" }
arg = {}
`;

/**
 * `lua-utf8` stub for Modules/Common.lua.
 *
 * Used for: utf8.reverse, utf8.gsub, utf8.find, utf8.sub, utf8.match, utf8.next
 * These are only used for number formatting with thousands separators,
 * which only involves ASCII digits. So we delegate to string functions.
 */
export const UTF8_SHIM = `
do
  local utf8mod = {}
  utf8mod.reverse = string.reverse
  utf8mod.gsub = string.gsub
  utf8mod.find = string.find
  utf8mod.sub = string.sub
  utf8mod.match = string.match
  utf8mod.len = string.len
  utf8mod.byte = string.byte
  utf8mod.char = string.char
  utf8mod.gmatch = string.gmatch
  utf8mod.format = string.format
  utf8mod.rep = string.rep
  utf8mod.lower = string.lower
  utf8mod.upper = string.upper
  function utf8mod.next(s, i, step)
    step = step or 1
    if step > 0 then
      local pos = i
      for _ = 1, step do
        if pos > #s then return nil end
        pos = pos + 1
      end
      return pos
    else
      local pos = i
      for _ = 1, -step do
        if pos <= 0 then return nil end
        pos = pos - 1
      end
      return pos
    end
  end
  package.preload["lua-utf8"] = function() return utf8mod end
end
`;

/**
 * All shims combined, in the order they must be applied.
 */
export const ALL_SHIMS = JIT_SHIM + BIT_SHIM + UTF8_SHIM;
