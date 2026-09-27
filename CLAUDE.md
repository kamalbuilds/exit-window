@AGENTS.md

## Visual rules

- Always read @DESIGN.md before generating any UI.
- Do not invent colours, fonts, radii, or spacing outside DESIGN.md. Add new tokens to DESIGN.md first, in its existing format, with a computed contrast ratio if the token carries text.
- Use semantic tokens (`var(--color-accent)` etc.), never raw hex, in components.
