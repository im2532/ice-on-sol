# Stepper

A vertical progress indicator for multi-step workflows. Shows completed, active, and upcoming steps with optional substeps for the active step.

**Figma source:** [AGENTIC-DESIGN-SYSTEM v1.2 — node 4001:1105](https://www.figma.com/design/FLribGjjakpYvdwuBTGTvD/AGENTIC-DESIGN-SYSTEM--v1.2-?node-id=4001-1105)

## Usage

```tsx
import { Stepper, StepperStep, StepperSubstep, StepperConnector } from '@/components/agentic/Stepper';
import { Icon } from '@/components/agentic/Icon/Icon';

<Stepper>
  <StepperStep variant="completed" label="Planning" icon={<Icon name="checkmark" size={16} />} />

  <StepperStep variant="active" label="Design" icon={<Icon name="magic-wand-filled" size={16} />}>
    <StepperSubstep state="completed" label="Concept" />
    <StepperSubstep state="completed" label="Simulation" />
    <StepperConnector />
    <StepperSubstep state="active" label="World" />
    <StepperSubstep state="disabled" label="Story" />
  </StepperStep>

  <StepperStep variant="disabled" label="Orchestration" icon={<Icon name="model-builder" size={16} />} />
</Stepper>
```

## Components

### `Stepper`

Wrapper container. Renders children in a vertical flex column with 8px gap.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | — | StepperStep and related elements |
| `className` | `string` | — | Additional CSS class |

### `StepperStep`

Individual step pill with icon and label.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'completed' \| 'active' \| 'disabled'` | — | Visual and semantic state |
| `label` | `string` | — | Step name |
| `icon` | `ReactNode` | — | Icon element (use `<Icon>` component) |
| `children` | `ReactNode` | — | Substeps rendered below the pill |
| `onClick` | `() => void` | — | Click handler; enables keyboard a11y when set |

**Hover states** (from Figma variant matrix):
- **Completed hover:** border strengthens, background darkens
- **Disabled hover:** border strengthens, text changes to primary
- **Active:** no hover variant

### `StepperSubstep`

Secondary step indicator within a parent step.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `state` | `'completed' \| 'active' \| 'disabled'` | — | Substep state |
| `label` | `string` | — | Substep name |

**Visual indicators:**
- Completed: green checkmark-filled + green text
- Active: pulsating dot + gradient shimmer text
- Disabled: gray circle outline + gray text

### `StepperConnector`

Vertical line between completed and active substeps. Decorative (`aria-hidden`).

### `PulsatingDot`

Animated concentric rings for active substep. Decorative (`aria-hidden`).

## Design tokens used

| Token | Usage |
|-------|-------|
| `--color-border-subtle` | Default step border |
| `--color-border-medium` | Hover step border |
| `--color-border-strong` | Active step border |
| `--color-bg-primary` | Active/disabled step background |
| `--color-bg-secondary` | Completed step background |
| `--color-content-primary` | Active label, active icon |
| `--color-content-secondary` | Disabled label |
| `--color-content-icon` | Completed/disabled step icons |
| `--color-content-success` | Completed substep text |
| `--color-hover-overlay` | Hover background overlay |

## Related components

- `Icon` — used for step icons
- `Navigation` — another vertical component using similar patterns
