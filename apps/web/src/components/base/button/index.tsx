import React, { forwardRef } from 'react';
import { Button as HeadlessButton } from '@headlessui/react';
import { memo, type ButtonHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';
import { Icon } from '@/components/base/icon';
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

    const renderLoadingIcon = () => {
      if (!loading) return null;

      const iconSizeMap: Record<string, { width: number; height: number }> = {
        large: { width: 18, height: 18 },
        medium: { width: 16, height: 16 },
        small: { width: 14, height: 14 },
      };
      const iconSize = iconSizeMap[size || 'medium'] || iconSizeMap.medium;

      return (
        <span className='animate-spin -ml-1 mr-2 inline-flex items-center'>
          <Icon
            name='base-loading_spinner'
            width={iconSize.width}
            height={iconSize.height}
            color='currentColor'
          />
        </span>
      );
    };

    let buttonContent: React.ReactNode;
    if (shape === 'circle') {
      if (loading) {
        buttonContent = renderLoadingIcon();
      } else if (icon || children) {
        buttonContent = (
          <span className={disabled ? 'opacity-40' : ''}>{icon || children}</span>
        );
      } else {
        buttonContent = null;
      }
    } else {
      let iconContent: React.ReactNode = null;
      if (icon && !loading) {
        iconContent = children
          ? <span className={cn('mr-2', disabled && 'opacity-40')}>{icon}</span>
          : <span className={disabled ? 'opacity-40' : ''}>{icon}</span>;
      }
      buttonContent = (
        <>
          {loading && !icon ? renderLoadingIcon() : null}
          {iconContent}
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
