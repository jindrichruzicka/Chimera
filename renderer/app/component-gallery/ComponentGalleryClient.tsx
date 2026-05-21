'use client';

import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Caption } from '../../components/ui/Caption';
import { Card } from '../../components/ui/Card';
import { Divider } from '../../components/ui/Divider';
import { Drawer } from '../../components/ui/Drawer';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { Heading } from '../../components/ui/Heading';
import { IconButton } from '../../components/ui/IconButton';
import { Label } from '../../components/ui/Label';
import { Modal } from '../../components/ui/Modal';
import { NumberInput } from '../../components/ui/NumberInput';
import { Panel } from '../../components/ui/Panel';
import { Popover } from '../../components/ui/Popover';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Select } from '../../components/ui/Select';
import type { SelectOption } from '../../components/ui/Select';
import { Slider } from '../../components/ui/Slider';
import { Spinner } from '../../components/ui/Spinner';
import { Tabs } from '../../components/ui/Tabs';
import type { TabItem } from '../../components/ui/Tabs';
import { Toggle } from '../../components/ui/Toggle';
import { ToggleButton } from '../../components/ui/ToggleButton';
import { Tooltip } from '../../components/ui/Tooltip';
import styles from './ComponentGallery.module.css';

// ── Panel definitions ─────────────────────────────────────────────────────────

function ActionsPanel(): React.ReactElement {
    const [togglePressed, setTogglePressed] = React.useState(false);
    return (
        <div className={styles['section']} data-testid="component-gallery-actions">
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Actions
            </Heading>
            <div className={styles['row']}>
                <Button data-testid="gallery-button-primary" variant="primary">
                    Primary
                </Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button data-testid="gallery-button-danger" variant="danger">
                    Danger
                </Button>
            </div>
            <div className={styles['row']}>
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
            </div>
            <div className={styles['row']}>
                <Button disabled>Disabled</Button>
                <IconButton aria-label="Add item" data-testid="gallery-icon-button">
                    +
                </IconButton>
                <ToggleButton
                    data-testid="gallery-toggle-button"
                    onPressedChange={setTogglePressed}
                    pressed={togglePressed}
                >
                    Toggle me
                </ToggleButton>
            </div>
        </div>
    );
}

function OverlaysPanel({
    modalOpen,
    onOpenModal,
    onCloseModal,
    drawerOpen,
    onOpenDrawer,
    onCloseDrawer,
}: {
    readonly modalOpen: boolean;
    readonly onOpenModal: () => void;
    readonly onCloseModal: () => void;
    readonly drawerOpen: boolean;
    readonly onOpenDrawer: () => void;
    readonly onCloseDrawer: () => void;
}): React.ReactElement {
    return (
        <div className={styles['section']} data-testid="component-gallery-overlays">
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Overlays
            </Heading>
            <div className={styles['row']}>
                <Button data-testid="gallery-open-modal" onClick={onOpenModal} variant="primary">
                    Open Modal
                </Button>
                <Button
                    data-testid="gallery-open-drawer"
                    onClick={onOpenDrawer}
                    variant="secondary"
                >
                    Open Drawer
                </Button>
                <Tooltip content="This is a tooltip example">
                    {(triggerProps) => (
                        <Button
                            {...triggerProps}
                            data-testid="gallery-tooltip-trigger"
                            variant="ghost"
                        >
                            Hover for Tooltip
                        </Button>
                    )}
                </Tooltip>
                <Popover
                    content={<p className={styles['popoverContent']}>This is a popover example.</p>}
                    label="Example Popover"
                >
                    {(triggerProps) => (
                        <Button
                            {...triggerProps}
                            data-testid="gallery-popover-trigger"
                            variant="ghost"
                        >
                            Open Popover
                        </Button>
                    )}
                </Popover>
            </div>
            <Modal onClose={onCloseModal} open={modalOpen} title="Example Modal">
                <p>This is an example modal from the component gallery.</p>
            </Modal>
            <Drawer
                data-testid="gallery-drawer"
                onClose={onCloseDrawer}
                open={drawerOpen}
                title="Example Drawer"
            >
                <p>This is an example drawer from the component gallery.</p>
            </Drawer>
        </div>
    );
}

function ContainersPanel(): React.ReactElement {
    return (
        <div className={styles['section']} data-testid="component-gallery-containers">
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Containers
            </Heading>
            <Panel title="Surface panel">
                <p>Panel with a surface variant — full-width content area.</p>
            </Panel>
            <Panel title="Raised panel" variant="raised">
                <p>Panel with a raised variant for elevated grouping.</p>
            </Panel>
            <Card>
                <p>Card — default surface, sm elevation, md padding.</p>
            </Card>
            <Card elevation="md" surface="raised">
                <p>Card — raised surface, md elevation.</p>
            </Card>
            <Divider />
            <Divider orientation="vertical" />
            <ScrollArea aria-label="Scroll area sample" className={styles['scrollSample']}>
                {Array.from({ length: 20 }, (_, i) => (
                    <p key={i} className={styles['scrollRow']}>
                        Scroll row {i + 1}
                    </p>
                ))}
            </ScrollArea>
        </div>
    );
}

function FormsPanel({
    toggleChecked,
    onToggleChange,
    sliderValue,
    onSliderChange,
    numberValue,
    onNumberChange,
    selectValue,
    onSelectChange,
}: {
    readonly toggleChecked: boolean;
    readonly onToggleChange: (checked: boolean) => void;
    readonly sliderValue: number;
    readonly onSliderChange: (value: number) => void;
    readonly numberValue: number;
    readonly onNumberChange: (value: number) => void;
    readonly selectValue: string;
    readonly onSelectChange: (value: string) => void;
}): React.ReactElement {
    const selectOptions: readonly SelectOption[] = [
        { label: 'Dark', value: 'dark' },
        { label: 'Light', value: 'light' },
        { label: 'System', value: 'system' },
    ];
    return (
        <div className={styles['section']} data-testid="component-gallery-forms">
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Forms
            </Heading>
            <div className={styles['formGroup']}>
                <Toggle
                    checked={toggleChecked}
                    label="Enable feature"
                    onCheckedChange={onToggleChange}
                />
                <Toggle
                    checked={false}
                    disabled
                    label="Disabled toggle"
                    onCheckedChange={() => undefined}
                />
            </div>
            <Slider
                label="Volume"
                max={100}
                min={0}
                onChange={onSliderChange}
                value={sliderValue}
            />
            <div className={styles['formRow']}>
                <NumberInput label="Quantity" onValueChange={onNumberChange} value={numberValue} />
                <NumberInput
                    error="Value must be positive"
                    invalid
                    label="Quantity (invalid)"
                    onValueChange={() => undefined}
                    value={-1}
                />
            </div>
            <div className={styles['formRow']}>
                <Select
                    label="Colour scheme"
                    onValueChange={onSelectChange}
                    options={selectOptions}
                    value={selectValue}
                />
                <Select
                    error="Required"
                    helperText="Pick a theme to continue"
                    invalid
                    label="Colour scheme (invalid)"
                    onValueChange={() => undefined}
                    options={selectOptions}
                    value=""
                />
            </div>
        </div>
    );
}

function FeedbackPanel(): React.ReactElement {
    return (
        <div className={styles['section']} data-testid="component-gallery-feedback">
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Feedback
            </Heading>
            <div className={styles['row']}>
                <Badge variant="neutral">Neutral</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="error">Error</Badge>
            </div>
            <ProgressBar label="Loading…" value={60} />
            <Spinner label="Loading content" />
        </div>
    );
}

function TypographyPanel(): React.ReactElement {
    return (
        <div className={styles['section']} data-testid="component-gallery-typography">
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Typography
            </Heading>
            <Heading level={1}>Heading 1</Heading>
            <Heading level={2}>Heading 2</Heading>
            <Heading level={3}>Heading 3</Heading>
            <Heading level={4} size="md">
                Heading 4 (md)
            </Heading>
            <Label>Label text</Label>
            <Label required>Required label</Label>
            <Label optional>Optional label</Label>
            <Caption>Caption — neutral</Caption>
            <Caption tone="muted">Caption — muted</Caption>
            <Caption tone="error">Caption — error</Caption>
            <Caption tone="success">Caption — success</Caption>
            <Heading className={styles['sectionTitle']} level={3} size="sm" tone="muted">
                Font tokens
            </Heading>
            <p
                className={`${styles['fontSample']} ${styles['fontSampleUi']}`}
                data-font-token="--ch-font-ui"
            >
                --ch-font-ui — Inter, system-ui, sans-serif
            </p>
            <p
                className={`${styles['fontSample']} ${styles['fontSampleGame']}`}
                data-font-token="--ch-font-game"
            >
                --ch-font-game — Cinzel, serif
            </p>
            <p
                className={`${styles['fontSample']} ${styles['fontSampleMono']}`}
                data-font-token="--ch-font-mono"
            >
                --ch-font-mono — JetBrains Mono, monospace
            </p>
        </div>
    );
}

// ── Gallery root ──────────────────────────────────────────────────────────────

export default function ComponentGalleryClient(): React.ReactElement {
    const [modalOpen, setModalOpen] = React.useState(false);
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const [toggleChecked, setToggleChecked] = React.useState(false);
    const [sliderValue, setSliderValue] = React.useState(50);
    const [numberValue, setNumberValue] = React.useState(1);
    const [selectValue, setSelectValue] = React.useState('dark');

    const tabs: readonly TabItem[] = [
        {
            id: 'actions',
            label: 'Actions',
            panel: <ActionsPanel />,
        },
        {
            id: 'overlays',
            label: 'Overlays',
            panel: (
                <OverlaysPanel
                    drawerOpen={drawerOpen}
                    modalOpen={modalOpen}
                    onCloseDrawer={() => setDrawerOpen(false)}
                    onCloseModal={() => setModalOpen(false)}
                    onOpenDrawer={() => {
                        setModalOpen(false);
                        setDrawerOpen(true);
                    }}
                    onOpenModal={() => {
                        setDrawerOpen(false);
                        setModalOpen(true);
                    }}
                />
            ),
        },
        {
            id: 'containers',
            label: 'Containers',
            panel: <ContainersPanel />,
        },
        {
            id: 'forms',
            label: 'Forms',
            panel: (
                <FormsPanel
                    numberValue={numberValue}
                    onNumberChange={setNumberValue}
                    onSelectChange={setSelectValue}
                    onSliderChange={setSliderValue}
                    onToggleChange={setToggleChecked}
                    selectValue={selectValue}
                    sliderValue={sliderValue}
                    toggleChecked={toggleChecked}
                />
            ),
        },
        {
            id: 'feedback',
            label: 'Feedback',
            panel: <FeedbackPanel />,
        },
        {
            id: 'typography',
            label: 'Typography',
            panel: <TypographyPanel />,
        },
    ];

    return (
        <div className={styles['gallery']} data-testid="component-gallery">
            <header className={styles['header']}>
                <h1 className={styles['title']}>Component Gallery</h1>
            </header>
            <Tabs ariaLabel="Component categories" defaultActiveTabId="actions" tabs={tabs} />
        </div>
    );
}
