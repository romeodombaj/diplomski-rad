import { Pressable, ActivityIndicator, type PressableProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Text } from './text';

const buttonVariants = cva(
  'flex-row items-center justify-center rounded-md active:opacity-80',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-transparent',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3',
        lg: 'h-12 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

const textVariants = cva('font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
    },
    size: {
      default: 'text-sm',
      sm: 'text-xs',
      lg: 'text-base',
      icon: 'text-sm',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

interface ButtonProps extends PressableProps, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  label: string;
}

export function Button({ label, variant, size, loading, disabled, className, ...props }: ButtonProps) {
  return (
    <Pressable
      className={cn(buttonVariants({ variant, size }), (disabled || loading) && 'opacity-50', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading
        ? <ActivityIndicator size="small" color={variant === 'default' || variant === 'destructive' ? '#ffffff' : '#18181b'} />
        : <Text className={cn(textVariants({ variant, size }))}>{label}</Text>
      }
    </Pressable>
  );
}
