import { defineConfig } from '@hey-api/openapi-ts';

/** FastAPI OpenAPI → oRPC contract (hey-api `orpc` plugin). */
export default defineConfig({
  input: './openapi/api-openapi.json',
  output: './generated/api',
  plugins: [
    {
      name: 'orpc',
      validator: {
        input: 'zod',
      },
    },
  ],
});
