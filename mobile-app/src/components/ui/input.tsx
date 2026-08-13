import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';

interface InputProps extends TextInputProps {
  error?: boolean;
}

export function Input({ className, error, ...props }: InputProps) {
  return (
    <TextInput
      className={cn(
        'h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        error && 'border-destructive',
        props.editable === false && 'opacity-50',
        className
      )}
      placeholderTextColor="#71717a"
      {...props}
    />
  );
}
