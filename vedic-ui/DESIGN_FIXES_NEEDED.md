# Design Fixes Needed - Complete Audit

## Issues Found & Recommended Fixes

### 1. Typography Inconsistencies

**Issue**: Mixed font sizes, tracking values, and weights
**Files Affected**: All pages

**Fixes Needed**:
- ✅ H1 (JUPITER logo): Always use `text-4xl tracking-widest`
- ✅ H2: Always use `text-2xl tracking-wider uppercase`
- ✅ H3: Always use `text-lg tracking-wide uppercase`
- ✅ Buttons: Always use `text-sm uppercase tracking-wide` (not `tracking-[0.3em]` or `text-[0.65rem]`)
- ✅ Body text: Use `text-sm` for normal, `text-xs` for small

### 2. Color Inconsistencies

**Issue**: Multiple shades of green and zinc being used

**Standardize**:
- Primary green: `text-green-400` / `bg-green-600` only
- Borders: `border-zinc-800` only (no `/40` opacity)
- Text: `text-zinc-100` (primary), `text-zinc-400` (secondary), `text-zinc-500` (muted)

### 3. Spacing Issues

**Issue**: Inconsistent padding/margins

**Standardize**:
- Button padding: `px-4 py-2` (standard) or `px-3 py-1.5` (compact)
- Card padding: `p-6` consistently
- Section gaps: `gap-4` for medium, `gap-6` for large
- Bottom margins: `mb-6` for sections, `mb-4` for elements

### 4. Button Style Inconsistencies

**Issue**: Different hover states, transitions, and styles

**Create 3 Button Variants**:

**Primary Button**:
```tsx
className="px-4 py-2 bg-green-600 hover:bg-green-700 text-black font-mono text-sm uppercase tracking-wide transition-colors"
```

**Secondary Button**:
```tsx
className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-sm uppercase tracking-wide transition-colors"
```

**Ghost Button**:
```tsx
className="px-4 py-2 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 font-mono text-sm uppercase tracking-wide transition-colors"
```

### 5. Card Styling

**Issue**: Mixed border opacities and shadows

**Standardize**:
```tsx
className="bg-zinc-900 border border-zinc-800 p-6"
```

### 6. Inline Styles

**Issue**: Using `style={{}}` instead of Tailwind classes

**Remove**:
- `style={{ fontSize: '0.65rem' }}` → Use `text-xs`
- `style={{ borderRadius: 0 }}` → Already handled by Tailwind
- All inline color/background styles → Use Tailwind classes

---

## Specific File Changes

### `/src/app/page.tsx`

**Line 2427**:
```tsx
// BEFORE
<h1 className="font-mono text-lg md:text-6xl tracking-widest text-green-400">

// AFTER
<h1 className="font-mono text-4xl tracking-widest text-green-400">
```

**Lines 2431-2451** (Auth buttons):
```tsx
// BEFORE
className="... text-[0.65rem] ... tracking-[0.3em]"

// AFTER
className="... text-xs ... tracking-wide"
```

**Lines 2454-2498** (Plan buttons):
- Remove all inline `style={}`
- Change `text-[0.65rem]` → `text-xs`
- Change `tracking-[0.3em]` → `tracking-wide`
- Simplify hover states to just `transition-colors`

**Lines 2508-2530** (Tab buttons):
- Remove `style={{}}` fontSize
- Use `text-xs` instead
- Standardize to tracking-wide

### `/src/app/account/page.tsx`

**Line 94**:
```tsx
// BEFORE
<h1 className="font-mono text-4xl tracking-widest text-green-400 mb-4">

// AFTER (add consistent margin)
<h1 className="font-mono text-4xl tracking-widest text-green-400 mb-6">
```

**Line 113**:
```tsx
// BEFORE
<p className="text-zinc-100 font-medium">{user.fullName || user.username}</p>

// AFTER (remove font-medium for consistency)
<p className="text-zinc-100">{user.fullName || user.username}</p>
```

**Line 119** (Sign Out button):
```tsx
// BEFORE
className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-none transition-all duration-200 text-sm font-mono uppercase tracking-wide"

// AFTER (remove rounded-none, transition-all duration-200)
className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-sm uppercase tracking-wide transition-colors"
```

**Line 133**:
```tsx
// BEFORE
<span className="text-green-400 font-medium">Active Subscription</span>

// AFTER (remove font-medium)
<span className="text-green-400">Active Subscription</span>
```

**Line 147**:
```tsx
// BEFORE
className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-none transition-all duration-200 text-sm font-mono uppercase tracking-wide disabled:opacity-50"

// AFTER
className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-sm uppercase tracking-wide transition-colors disabled:opacity-50"
```

**Line 230** (Subscribe button):
```tsx
// BEFORE
className="px-6 py-3 bg-green-600 hover:bg-green-700 text-black rounded-none transition-all duration-200 font-mono uppercase tracking-wide disabled:opacity-50"

// AFTER (standardize padding, remove unnecessary classes)
className="px-4 py-2 bg-green-600 hover:bg-green-700 text-black font-mono text-sm uppercase tracking-wide transition-colors disabled:opacity-50"
```

### `/src/app/page.tsx` (Upgrade Modal)

**Lines 3131-3164**:
- Use design system colors
- Standardize button styles
- Fix spacing

---

## Summary of Changes

### Replace All Instances:
1. `text-[0.65rem]` → `text-xs`
2. `tracking-[0.3em]` or `tracking-[0.4em]` or `tracking-[0.45em]` → `tracking-wide`
3. `transition-all duration-200` → `transition-colors`
4. `rounded-none` → (remove, it's default)
5. `border-zinc-800/40` → `border-zinc-800`
6. `font-medium` → (remove for consistency)
7. Remove all `style={{}}` inline styles

### Add Everywhere:
- `font-mono` to all text
- `uppercase` to all buttons and headings
- `transition-colors` to all interactive elements

### Standardize Spacing:
- Headers: `mb-6`
- Sections: `mb-6`, `gap-6`
- Elements: `mb-4`, `gap-4`
- Buttons: `px-4 py-2` or `px-3 py-1.5`

---

## Priority Fixes (Do First)

1. **Main page header** - Fix H1 responsive sizing
2. **All buttons** - Standardize to 3 variants
3. **Typography** - Replace all custom font sizes
4. **Remove inline styles** - Use Tailwind only

This will make the app feel much more polished and consistent! 🎨
