// Ambient declarations for Bun's `import ... with { type: "text" }` — lets the
// embedded resource files (SKILL.md, hook script) type-check as strings.

declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.sh" {
  const content: string;
  export default content;
}
