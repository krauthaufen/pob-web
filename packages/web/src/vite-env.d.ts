/// <reference types="vite/client" />

declare module "../../wasm/lua.mjs" {
  const createModule: (opts?: any) => Promise<any>;
  export default createModule;
}

declare module "pako" {
  export function inflate(data: Uint8Array): Uint8Array;
  export function deflate(data: Uint8Array): Uint8Array;
}
