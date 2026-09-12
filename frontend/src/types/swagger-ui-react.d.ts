declare module 'swagger-ui-react' {
  import type { ComponentType } from 'react';

  interface SwaggerUIProps {
    url?: string;
    spec?: object;
    docExpansion?: 'list' | 'full' | 'none';
    defaultModelsExpandDepth?: number;
    tryItOutEnabled?: boolean;
    supportedSubmitMethods?: string[];
  }

  const SwaggerUI: ComponentType<SwaggerUIProps>;
  export default SwaggerUI;
}
