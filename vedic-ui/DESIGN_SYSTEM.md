# JUPITER Design System

## Colors

### Primary
- **Green (Primary)**: `text-green-400` / `#4ade80` - Main brand color
- **Green (Hover)**: `text-green-500` / `#22c55e`
- **Green (Active)**: `bg-green-600` / `#16a34a`

### Neutrals
- **Background**: `bg-black` / `#000000`
- **Surface**: `bg-zinc-900` / `#18181b`
- **Border**: `border-zinc-800` / `#27272a`
- **Text Primary**: `text-zinc-100` / `#f4f4f5`
- **Text Secondary**: `text-zinc-400` / `#a1a1aa`
- **Text Muted**: `text-zinc-500` / `#71717a`

## Typography

### Font Family
- **All text**: `font-mono` (monospace)

### Headings
- **H1**: `text-4xl tracking-widest` (JUPITER logo)
- **H2**: `text-2xl tracking-wider uppercase`
- **H3**: `text-lg tracking-wide uppercase`
- **H4**: `text-sm tracking-wide uppercase`

### Body
- **Large**: `text-base`
- **Normal**: `text-sm`
- **Small**: `text-xs`
- **Tiny**: `text-[0.65rem]`

### Tracking
- **Logo/Brand**: `tracking-widest`
- **Headings**: `tracking-wider`
- **Subheadings**: `tracking-wide`
- **Buttons**: `tracking-wide`

## Spacing

### Padding
- **Button**: `px-4 py-2`
- **Button Small**: `px-3 py-1`
- **Card**: `p-6`
- **Container**: `p-8`

### Margins
- **Section**: `mb-6`
- **Element**: `mb-4`
- **Small**: `mb-2`

### Gaps
- **Large**: `gap-6`
- **Medium**: `gap-4`
- **Small**: `gap-2`

## Components

### Buttons

**Primary**:
```
className="px-4 py-2 bg-green-600 hover:bg-green-700 text-black font-mono text-sm uppercase tracking-wide transition-colors"
```

**Secondary**:
```
className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-sm uppercase tracking-wide transition-colors"
```

**Ghost**:
```
className="px-4 py-2 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-mono text-sm uppercase tracking-wide transition-colors"
```

### Cards
```
className="bg-zinc-900 border border-zinc-800 p-6"
```

### Tabs
```
className="px-4 py-2 font-mono text-xs uppercase tracking-wide border transition-colors"
```

## Rules

1. ✅ Always use `font-mono`
2. ✅ Always use `uppercase` for buttons and headings
3. ✅ Use `text-green-400` for primary brand color
4. ✅ Use `tracking-wide` or `tracking-wider` (never custom values)
5. ✅ Use Tailwind classes, avoid inline styles
6. ✅ All buttons should have `transition-colors`
7. ✅ Cards always have `border border-zinc-800`
