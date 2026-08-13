import { Modal, View, Pressable } from 'react-native';
import { Text } from './text';
import { Button } from './button';

interface AlertDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onCancel}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/50"
        onPress={onCancel}
      >
        <Pressable
          className="w-80 rounded-xl border border-border bg-background p-6 shadow-xl"
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="h4" className="mb-2">{title}</Text>
          {description && (
            <Text variant="muted" className="mb-5">{description}</Text>
          )}
          <View className="flex-row gap-3 justify-end">
            <Button
              label={cancelLabel}
              variant="outline"
              size="sm"
              onPress={onCancel}
            />
            <Button
              label={confirmLabel}
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              onPress={onConfirm}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
