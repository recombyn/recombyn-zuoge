import { memo } from 'react';
import { Checkbox } from './Checkbox';
import { CheckboxGroup } from './CheckboxGroup';
import type { CheckboxProps, CheckboxChangeEvent, CheckboxGroupOption } from './Checkbox';
import type { CheckboxGroupProps } from './CheckboxGroup';

/** Attach `Group` for static `Checkbox.Group` usage */
(Checkbox as typeof Checkbox & { Group: typeof CheckboxGroup }).Group = CheckboxGroup;

export default memo(Checkbox);
export { Checkbox, CheckboxGroup };
export type { CheckboxProps, CheckboxGroupProps, CheckboxGroupOption, CheckboxChangeEvent };
