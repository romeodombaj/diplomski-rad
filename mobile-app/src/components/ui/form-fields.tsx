import { View, type TextInputProps } from 'react-native';
import { Text } from './text';
import { Input } from './input';

interface FormInputProps extends TextInputProps {
  label: string;
  error?: string;
}

export function FormInput({ label, error, ...props }: FormInputProps) {
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <Input error={!!error} {...props} />
      {error && <Text variant="destructive">{error}</Text>}
    </View>
  );
}

interface FormTextareaProps extends TextInputProps {
  label: string;
  error?: string;
}

export function FormTextarea({ label, error, ...props }: FormTextareaProps) {
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <Input
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        className="h-24 py-2"
        error={!!error}
        {...props}
      />
      {error && <Text variant="destructive">{error}</Text>}
    </View>
  );
}
