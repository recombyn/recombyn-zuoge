import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges conditional class names and resolves Tailwind conflicts via `tailwind-merge`.
 *
 * @example
 * cn('px-2 py-1', 'px-4') // => 'py-1 px-4'
 * cn('bg-red-500', isActive && 'bg-blue-500')
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
