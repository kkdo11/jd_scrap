import { createApp } from './server';

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => {
  console.log(`🌐 웹 서버 실행: http://localhost:${port}`);
  console.log('   브라우저에서 위 주소를 열어 사용하세요. (Ollama 서버가 켜져 있어야 합니다)');
});
