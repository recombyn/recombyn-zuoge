/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    theme: {
      extend: {
        colors: {
          brand: {
            50: '#e8f0ff',
            100: '#d6e4ff',
            500: '#3370ff',
            600: '#245bdb',
            700: '#1a4ac8',
          },
        },
        fontFamily: {
          sans: [
            '"Alibaba PuHuiTi"',
            '"阿里巴巴普惠体"',
            '"PingFang SC"',
            '"Microsoft YaHei"',
            '"Noto Sans SC"',
            'system-ui',
            'sans-serif',
          ],
        },
      },
    },
    plugins: [],
  };