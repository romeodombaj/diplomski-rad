import { View, type TextInputProps } from 'react-native';
import { Search } from 'lucide-react-native';
import { Input } from './input';

interface SearchInputProps extends TextInputProps {
  placeholder?: string;
}

export function SearchInput({ placeholder = 'Search...', ...props }: SearchInputProps) {
  return (
    <View className="relative flex-row items-center">
      <Search size={16} color="#71717a" className="absolute left-3 z-10" />
      <Input
        className="pl-9"
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </View>
  );
}
