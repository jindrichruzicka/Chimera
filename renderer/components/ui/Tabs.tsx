'use client';

import React, { useCallback, useId, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, KeyboardEvent } from 'react';
import styles from './Tabs.module.css';

export type TabItem = Readonly<{
    readonly id: string;
    readonly label: React.ReactNode;
    readonly panel: React.ReactNode;
    readonly disabled?: boolean;
    readonly testId?: string;
}>;

export type TabsProps = Readonly<
    Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'onChange'> & {
        readonly tabs: readonly TabItem[];
        readonly activeTabId?: string;
        readonly defaultActiveTabId?: string;
        readonly onActiveTabChange?: (tabId: string) => void;
        readonly ariaLabel: string;
        readonly style?: CSSProperties;
    }
>;

function getEnabledTabIds(tabs: readonly TabItem[]): readonly string[] {
    return tabs.filter((tab) => !tab.disabled).map((tab) => tab.id);
}

function resolveActiveTabId(
    tabs: readonly TabItem[],
    requestedTabId: string | undefined,
): string | undefined {
    const requestedTab = tabs.find((tab) => tab.id === requestedTabId && !tab.disabled);
    if (requestedTab) {
        return requestedTab.id;
    }

    return tabs.find((tab) => !tab.disabled)?.id;
}

function getWrappedTabId(
    enabledTabIds: readonly string[],
    currentTabId: string,
    direction: 'previous' | 'next',
): string | undefined {
    if (enabledTabIds.length === 0) {
        return undefined;
    }

    const currentIndex = enabledTabIds.indexOf(currentTabId);
    const fallbackIndex = 0;
    const activeIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const nextIndex =
        direction === 'next'
            ? (activeIndex + 1) % enabledTabIds.length
            : (activeIndex - 1 + enabledTabIds.length) % enabledTabIds.length;

    return enabledTabIds[nextIndex];
}

function getTabDomId(baseId: string, tabId: string): string {
    return `${baseId}-${tabId}-tab`;
}

function getPanelDomId(baseId: string, tabId: string): string {
    return `${baseId}-${tabId}-panel`;
}

export function Tabs({
    tabs,
    activeTabId,
    defaultActiveTabId,
    onActiveTabChange,
    ariaLabel,
    className,
    style,
    ...tabsProps
}: TabsProps): React.ReactElement {
    const baseId = useId();
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const tabRefCallbacks = useRef<Map<string, (el: HTMLButtonElement | null) => void>>(new Map());
    const [uncontrolledActiveTabId, setUncontrolledActiveTabId] = useState(() =>
        resolveActiveTabId(tabs, defaultActiveTabId),
    );
    const isControlled = activeTabId !== undefined;
    const selectedTabId = resolveActiveTabId(
        tabs,
        isControlled ? activeTabId : uncontrolledActiveTabId,
    );
    const classNames = [styles['tabs'], className].filter(Boolean).join(' ');

    const getTabRefCallback = useCallback(
        (tabId: string): ((el: HTMLButtonElement | null) => void) => {
            const existing = tabRefCallbacks.current.get(tabId);
            if (existing) {
                return existing;
            }

            const cb = (element: HTMLButtonElement | null): void => {
                if (element) {
                    tabRefs.current.set(tabId, element);
                } else {
                    tabRefs.current.delete(tabId);
                }
            };

            tabRefCallbacks.current.set(tabId, cb);
            return cb;
        },
        [],
    );

    const activateTab = useCallback(
        (nextTabId: string): void => {
            const nextTab = tabs.find((tab) => tab.id === nextTabId);
            if (!nextTab || nextTab.disabled || nextTab.id === selectedTabId) {
                return;
            }

            if (!isControlled) {
                setUncontrolledActiveTabId(nextTab.id);
            }

            onActiveTabChange?.(nextTab.id);
        },
        [isControlled, onActiveTabChange, selectedTabId, tabs],
    );

    const focusAndActivateTab = useCallback(
        (nextTabId: string | undefined): void => {
            if (nextTabId === undefined) {
                return;
            }

            activateTab(nextTabId);
            tabRefs.current.get(nextTabId)?.focus();
        },
        [activateTab],
    );

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLButtonElement>, currentTabId: string): void => {
            const enabledTabIds = getEnabledTabIds(tabs);

            switch (event.key) {
                case 'ArrowLeft':
                    event.preventDefault();
                    focusAndActivateTab(getWrappedTabId(enabledTabIds, currentTabId, 'previous'));
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    focusAndActivateTab(getWrappedTabId(enabledTabIds, currentTabId, 'next'));
                    break;
                case 'Home':
                    event.preventDefault();
                    focusAndActivateTab(enabledTabIds[0]);
                    break;
                case 'End':
                    event.preventDefault();
                    focusAndActivateTab(enabledTabIds[enabledTabIds.length - 1]);
                    break;
                default:
                    break;
            }
        },
        [focusAndActivateTab, tabs],
    );

    return (
        <div {...tabsProps} className={classNames} style={style}>
            <div aria-label={ariaLabel} className={styles['tablist']} role="tablist">
                {tabs.map((tab) => {
                    const isSelected = tab.id === selectedTabId;
                    const tabClassNames = [
                        styles['tab'],
                        isSelected ? styles['tab-active'] : undefined,
                    ]
                        .filter(Boolean)
                        .join(' ');

                    return (
                        <button
                            aria-controls={getPanelDomId(baseId, tab.id)}
                            aria-disabled={tab.disabled ? true : undefined}
                            aria-selected={isSelected}
                            className={tabClassNames}
                            data-active={String(isSelected)}
                            data-testid={tab.testId}
                            disabled={tab.disabled}
                            id={getTabDomId(baseId, tab.id)}
                            key={tab.id}
                            onClick={() => activateTab(tab.id)}
                            onKeyDown={(event) => handleKeyDown(event, tab.id)}
                            ref={getTabRefCallback(tab.id)}
                            role="tab"
                            tabIndex={isSelected ? 0 : -1}
                            type="button"
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            {tabs.map((tab) => {
                const isSelected = tab.id === selectedTabId;

                return (
                    <div
                        aria-labelledby={getTabDomId(baseId, tab.id)}
                        className={styles['tabpanel']}
                        hidden={!isSelected}
                        id={getPanelDomId(baseId, tab.id)}
                        key={tab.id}
                        role="tabpanel"
                        tabIndex={0}
                    >
                        {tab.panel}
                    </div>
                );
            })}
        </div>
    );
}
