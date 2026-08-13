import { Text as RNText, type TextProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      default: 'text-base',
      h1: 'text-3xl font-bold',
      h2: 'text-2xl font-semibold',
      h3: 'text-xl font-semibold',
      h4: 'text-lg font-semibold',
      muted: 'text-sm text-muted-foreground',
      destructive: 'text-sm text-destructive',
      success: 'text-sm text-green-600',
      label: 'text-sm font-medium',
    },
  },
  defaultVariants: { variant: 'default' },
});

interface Props extends TextProps, VariantProps<typeof textVariants> {}

export function Text({ className, variant, ...props }: Props) {
  return <RNText className={cn(textVariants({ variant }), className)} {...props} />;
}
