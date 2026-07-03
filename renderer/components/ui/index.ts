export { Badge } from './Badge';
export type { BadgeProps, BadgeVariant } from './Badge';
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Caption } from './Caption';
export type { CaptionProps, CaptionTone } from './Caption';
export { Card } from './Card';
export type { CardElevation, CardElement, CardPadding, CardProps, CardSurface } from './Card';
export { Divider } from './Divider';
export type { DividerOrientation, DividerProps } from './Divider';
export { Drawer } from './Drawer';
export type { DrawerPlacement, DrawerProps } from './Drawer';
export { Heading } from './Heading';
export type { HeadingLevel, HeadingProps, HeadingSize, HeadingTone } from './Heading';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { Label } from './Label';
export type { LabelProps, LabelState } from './Label';
export { Modal } from './Modal';
export type { ModalAction, ModalProps } from './Modal';
export { NumberInput } from './NumberInput';
export type { NumberInputProps } from './NumberInput';
export { Panel } from './Panel';
export type { PanelProps, PanelVariant } from './Panel';
export { Popover } from './Popover';
export type { PopoverAlign, PopoverPlacement, PopoverProps, PopoverTriggerProps } from './Popover';
export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps } from './ProgressBar';
export { ScrollArea } from './ScrollArea';
export type { ScrollAreaProps } from './ScrollArea';
export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';
export { Slider } from './Slider';
export type { SliderProps } from './Slider';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { Tabs } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';
export { TextInput } from './TextInput';
export type { TextInputProps } from './TextInput';
export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';
export { ToggleButton } from './ToggleButton';
export type { ToggleButtonProps } from './ToggleButton';
export { Tooltip } from './Tooltip';
export type { TooltipProps, TooltipTriggerProps } from './Tooltip';

// EscapeStackProvider is the runtime contract for Modal/Drawer: both register
// Escape-to-close on the shared overlay stack via useEscapeLayer, so any consumer
// of these primitives must mount the provider above them (the app root does this
// in <Providers>). Surfaced through the public ui barrel so game packages — which
// may import only this barrel — can supply it, notably when rendering the
// primitives in isolation under test.
export { EscapeStackProvider, useEscapeLayer } from '../shell/EscapeStack';
export type { EscapeStackProviderProps } from '../shell/EscapeStack';
