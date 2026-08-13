import { View, Image, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { Text } from './text';

interface AvatarProps extends ViewProps {
  src?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: { container: 'h-8 w-8', text: 'text-xs' },
  md: { container: 'h-10 w-10', text: 'text-sm' },
  lg: { container: 'h-14 w-14', text: 'text-lg' },
};

function initials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0][0].toUpperCase();
}

export function Avatar({ src, name, size = 'md', className, ...props }: AvatarProps) {
  const { container, text } = sizes[size];
  return (
    <View
      className={cn('items-center justify-center overflow-hidden rounded-full bg-muted', container, className)}
      {...props}
    >
      {src
        ? <Image source={{ uri: src }} className="h-full w-full" resizeMode="cover" />
        : <Text className={cn('font-semibold text-muted-foreground', text)}>{initials(name)}</Text>
      }
    </View>
  );
}
