import { View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { Text } from './text';

export function Card({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('mb-3 gap-1', className)} {...props} />;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Text variant="h4" className={cn('text-card-foreground', className)}>{children}</Text>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Text variant="muted" className={cn(className)}>{children}</Text>;
}

export function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('gap-3', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ViewProps) {
  return <View className={cn('mt-4 flex-row items-center', className)} {...props} />;
}
