import { useEffect, useRef } from 'react';
import { Animated, View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: ViewProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity }}>
      <View className={cn('rounded-md bg-muted', className)} {...props} />
    </Animated.View>
  );
}
