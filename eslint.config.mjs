import base from '@jabrown93/dev-config/eslint';

const eslintConfig = [
  ...base,
  {
    ignores: [
      '**/homebridge-ui',
      '**/dist',
      'package-lock.json',
      'package.json',
    ],
  },
];

export default eslintConfig;
