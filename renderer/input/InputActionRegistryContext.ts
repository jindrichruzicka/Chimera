'use client';

import { createContext, useContext } from 'react';

import type { InputActionRegistry } from './InputActionRegistry.js';

export const InputActionRegistryContext = createContext<InputActionRegistry | null>(null);

export function useOptionalInputActionRegistry(): InputActionRegistry | null {
    return useContext(InputActionRegistryContext);
}
