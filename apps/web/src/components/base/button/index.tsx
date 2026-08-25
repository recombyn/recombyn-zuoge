import React, { forwardRef } from 'react';
import { Button as HeadlessButton } from '@headlessui/react';
import { memo, type ButtonHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { cn } from '@/utils/classnames';
import './index.css';

const buttonVariants = cva(
  'rcb-btn disabled:rcb-btn-disabled',
  {
    variants: {
      type: {
        'primary': 'rcb-btn-primary',
        'default': 'rcb-btn-default',
        'dark': 'rcb-btn-dark',
      },
      size: {
        small: 'rcb-btn-small',
        medium: 'rcb-btn-medium',
        large: 'rcb-btn-large',
      },
      destructive: {
        true: 'rcb-btn-destructive',
        false: '',
      },
      shape: {
        default: 'rcb-btn-shape-default',
        round: 'rcb-btn-shape-round',
        circle: 'rcb-btn-shape-circle',
      },
    },
    defaultVariants: {
      type: 'default',
      size: 'medium',
      destructive: false,
      shape: 'default',
    },
  }
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: ButtonVariantProps['type'];
  size?: ButtonVariantProps['size'];
  /** @default false */
  destructive?: boolean;
  /** @default 'default' */
  shape?: 'default' | 'circle' | 'round';
  /** @default true */
  bordered?: boolean;
  block?: boolean;
  /** @default false */
  loading?: boolean;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/** Headless UI button with CVA variants. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      type,
      size,
      destructive = false,
      shape = 'default',
      bordered = true,
      block = false,
      loading = false,
      disabled = false,
      children,
      icon,
      className,
      onClick,
      ...rest
    },
    ref
  ) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (loading || disabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };

    const spinnerSize = size === 'large' ? 16 : size === 'small' ? 12 : 14;
    const renderLoadingIcon = (trailingGap = true) =>
      loading ? (
        <span
          aria-hidden
          className={cn(
            'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-90',
            trailingGap && 'mr-2'
          )}
          style={{ width: spinnerSize, height: spinnerSize }}
        />
      ) : null;

    let buttonContent: React.ReactNode = null;
    if (shape === 'circle') {
      buttonContent = loading
        ? renderLoadingIcon(false)
        : icon || children
          ? <span className={disabled ? 'opacity-40' : ''}>{icon || children}</span>
          : null;
    } else {
      const showIcon = Boolean(icon) && !loading;
      buttonContent = (
        <>
          {loading && !icon ? renderLoadingIcon() : null}
          {showIcon ? (
            <span className={cn(children && 'mr-2', disabled && 'opacity-40')}>{icon}</span>
          ) : null}
          {children}
        </>
      );
    }

    return (
      <HeadlessButton
        ref={ref}
        className={cn(
          buttonVariants({ type, size, destructive, shape }),
          !bordered && '!border-0',
          block && 'w-full',
          loading && 'cursor-wait',
          className
        )}
        style={rest.style}
        disabled={disabled || loading}
        onClick={handleClick}
        {...rest}
      >
        {buttonContent}
      </HeadlessButton>
    );
  }
);

Button.displayName = 'Button';

export default memo(Button);
export { Button, buttonVariants };
export type { ButtonProps };
