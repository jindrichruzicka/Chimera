'use client';

import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Caption } from '../../components/ui/Caption';
import { Card } from '../../components/ui/Card';
import { Heading } from '../../components/ui/Heading';
import { IconButton } from '../../components/ui/IconButton';
import { Label } from '../../components/ui/Label';
import { Modal } from '../../components/ui/Modal';
import { NumberInput } from '../../components/ui/NumberInput';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Select } from '../../components/ui/Select';
import type { SelectOption } from '../../components/ui/Select';
import { Slider } from '../../components/ui/Slider';
import { Spinner } from '../../components/ui/Spinner';
import { Tabs } from '../../components/ui/Tabs';
import type { TabItem } from '../../components/ui/Tabs';
import { Toggle } from '../../components/ui/Toggle';
import { ToggleButton } from '../../components/ui/ToggleButton';
import styles from './ComponentGallery.module.css';

// ── Panel definitions ─────────────────────────────────────────────────────────

function ActionsPanel(): React.ReactElement {
    const [togglePressed, setTogglePressed] = React.useState(false);
    return (
        <div className={styles['section']}>
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Actions
            </Heading>
            <div className={styles['row']}>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
            </div>
            <div className={styles['row']}>
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
            </div>
            <div className={styles['row']}>
                <Button disabled>Disabled</Button>
                <IconButton aria-label="Add item">+</IconButton>
                <ToggleButton pressed={togglePressed} onPressedChange={setTogglePressed}>
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
}: {
    readonly modalOpen: boolean;
    readonly onOpenModal: () => void;
    readonly onCloseModal: () => void;
}): React.ReactElement {
    return (
        <div className={styles['section']}>
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Overlays
            </Heading>
            <div className={styles['row']}>
                <Button data-testid="gallery-open-modal" onClick={onOpenModal} variant="primary">
                    Open Modal
                </Button>
            </div>
            <Modal onClose={onCloseModal} open={modalOpen} title="Example Modal">
                <p>This is an example modal from the component gallery.</p>
            </Modal>
        </div>
    );
}

function ContainersPanel(): React.ReactElement {
    return (
        <div className={styles['section']}>
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Containers
            </Heading>
            <Panel>
                <p>This is a Panel component.</p>
            </Panel>
            <Card>
                <p>This is a Card component.</p>
            </Card>
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
        <div className={styles['section']}>
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Forms
            </Heading>
            <Toggle
                checked={toggleChecked}
                label="Enable feature"
                onCheckedChange={onToggleChange}
            />
            <Slider
                label="Volume"
                max={100}
                min={0}
                onChange={onSliderChange}
                value={sliderValue}
            />
            <NumberInput label="Quantity" onValueChange={onNumberChange} value={numberValue} />
            <Select
                label="Colour scheme"
                onValueChange={onSelectChange}
                options={selectOptions}
                value={selectValue}
            />
        </div>
    );
}

function FeedbackPanel(): React.ReactElement {
    return (
        <div className={styles['section']}>
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
        <div className={styles['section']}>
            <Heading className={styles['sectionTitle']} level={3} tone="muted">
                Typography
            </Heading>
            <Heading level={1}>Heading 1</Heading>
            <Heading level={2}>Heading 2</Heading>
            <Heading level={3}>Heading 3</Heading>
            <Label>Label text</Label>
            <Caption>Caption text — small supplementary copy</Caption>
        </div>
    );
}

// ── Gallery root ──────────────────────────────────────────────────────────────

export default function ComponentGalleryClient(): React.ReactElement {
    const [modalOpen, setModalOpen] = React.useState(false);
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
                    modalOpen={modalOpen}
                    onCloseModal={() => setModalOpen(false)}
                    onOpenModal={() => setModalOpen(true)}
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
