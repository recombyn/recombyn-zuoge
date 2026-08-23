import { createContext } from 'react';
import type { CheckboxGroupContextValue } from './Checkbox';

/** Checkbox group React context */
export const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(null);

