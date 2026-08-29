/**
 * swagger-ui-react ships no type declarations, which fails the build under
 * `noImplicitAny`. Only the Docs page uses it, and only with a spec URL, so
 * this covers the props actually passed rather than the full surface.
 */
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
