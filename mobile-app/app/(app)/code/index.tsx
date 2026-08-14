import { useState, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function CodeScreen() {
  const { t } = useTranslation();
  const [currentCode, setCurrentCode] = useState('');
  const [timeLeft, setTimeLeft] = useState(10);

  const refreshCode = useCallback(() => {
    // Generate a random 6-digit code for demo
    // In production, this would be generated from a stored TOTP secret
    const randomDigits = Math.floor(Math.random() * 900000 + 100000).toString();
    setCurrentCode(randomDigits);
    setTimeLeft(10);
  }, []);

  useEffect(() => {
    refreshCode();

    const interval = setInterval(() => {
      refreshCode();
    }, 10000);

    const countdownInterval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) return 10;
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdownInterval);
    };
  }, [refreshCode]);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
      (navigator as any).clipboard?.writeText(currentCode)
        .catch(() => {});
    }
  };

  const progress = timeLeft / 10;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="p-4 gap-4">
        <Text variant="h2">{t('code.title')}</Text>

        <Card className="items-center py-6">
          <CardHeader>
            <CardTitle>{t('code.yourCode')}</CardTitle>
            <CardDescription>{t('code.codeDescription')}</CardDescription>
          </CardHeader>

          <CardContent className="items-center gap-4">
            {/* Code display */}
            <View className="rounded-xl border-2 border-primary bg-primary/5 px-8 py-4">
              <Text variant="h1" className="font-mono tracking-widest text-3xl text-primary">
                {currentCode}
              </Text>
            </View>

            {/* Countdown timer */}
            <View className="w-full gap-2">
              <View className="flex-row items-center justify-between">
                <Text variant="muted">{t('code.nextCodeIn')}</Text>
                <Text variant="default" className="font-mono text-primary">
                  {timeLeft}s
                </Text>
              </View>

              {/* Progress bar */}
              <View className="h-1.5 w-full rounded-full bg-secondary">
                <View
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: `${progress * 100}%` }}
                />
              </View>
            </View>

            {/* Copy button */}
            <Button variant="outline" onPress={handleCopy} label={t('code.copyCode')} />
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>{t('code.instructions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="gap-2">
              <View className="flex-row items-start gap-2">
                <Text variant="default" className="font-bold text-primary">1.</Text>
                <Text variant="muted" className="text-muted-foreground flex-1">
                  {t('code.step1')}
                </Text>
              </View>
              <View className="flex-row items-start gap-2">
                <Text variant="default" className="font-bold text-primary">2.</Text>
                <Text variant="muted" className="text-muted-foreground flex-1">
                  {t('code.step2')}
                </Text>
              </View>
              <View className="flex-row items-start gap-2">
                <Text variant="default" className="font-bold text-primary">3.</Text>
                <Text variant="muted" className="text-muted-foreground flex-1">
                  {t('code.step3')}
                </Text>
              </View>
            </View>
          </CardContent>
        </Card>
      </View>
    </SafeAreaView>
  );
}
