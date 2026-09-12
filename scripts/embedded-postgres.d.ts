// embedded-postgres ships types at dist/index.d.ts but its package.json has only an exports string and no
// "types" field, which the root tsconfig's node10 resolution cannot follow. Point the bare specifier at the
// shipped declarations (type-only; the runtime import is unchanged).
declare module "embedded-postgres" {
  import EmbeddedPostgres from "embedded-postgres/dist/index";
  export default EmbeddedPostgres;
}
