/**
 * DART API에서 전체 기업코드 수집 스크립트
 * 실행: node scripts/collectCorpCodes.js
 */

require('dotenv').config();
const axios = require('axios');
const JSZip = require('jszip');
const fs = require('fs');

const DART_API_KEY = process.env.DART_API_KEY;

async function collectCorpCodes() {
  console.log('DART 기업코드 수집 시작...');

  try {
    // 1. DART API에서 기업코드 ZIP 다운로드
    const response = await axios.get('https://opendart.fss.or.kr/api/corpCode.xml', {
      params: { crtfc_key: DART_API_KEY },
      responseType: 'arraybuffer',
      timeout: 30000
    });

    // 2. ZIP 파일 파싱
    const zip = new JSZip();
    const contents = await zip.loadAsync(response.data);
    const xmlFile = Object.keys(contents.files)[0];
    const xmlText = await contents.files[xmlFile].async('text');

    console.log(`XML 파일 크기: ${xmlText.length.toLocaleString()} bytes`);

    // 3. 모든 상장기업 추출 (stock_code가 있는 기업만)
    const regex = /<list>[\s\S]*?<corp_code>([^<]+)<\/corp_code>[\s\S]*?<corp_name>([^<]+)<\/corp_name>[\s\S]*?<stock_code>\s*(\d{6})\s*<\/stock_code>[\s\S]*?<\/list>/g;

    const corpMap = new Map();
    let match;

    while ((match = regex.exec(xmlText)) !== null) {
      const [, corpCode, corpName, stockCode] = match;
      const cleanCorpCode = corpCode.trim();
      const cleanCorpName = corpName.trim();
      const cleanStockCode = stockCode.trim();

      // 중복 체크 - 이미 있으면 더 짧은 이름 선택 (보통 본체)
      if (corpMap.has(cleanStockCode)) {
        const existing = corpMap.get(cleanStockCode);
        // 더 짧은 이름이 보통 본체
        if (cleanCorpName.length < existing.corpName.length) {
          corpMap.set(cleanStockCode, {
            corpCode: cleanCorpCode,
            corpName: cleanCorpName
          });
        }
      } else {
        corpMap.set(cleanStockCode, {
          corpCode: cleanCorpCode,
          corpName: cleanCorpName
        });
      }
    }

    console.log(`총 ${corpMap.size}개 상장기업 발견`);

    // 4. 종목 리스트와 매칭
    const StockListService = require('../services/stockListService');
    const stockList = StockListService.getUnifiedStockList();

    // 중복 제거
    const uniqueStocks = [...new Set(stockList)];
    console.log(`분석 대상: ${uniqueStocks.length}개 종목`);

    const matched = [];
    const notFound = [];

    for (const stockCode of uniqueStocks) {
      if (corpMap.has(stockCode)) {
        const info = corpMap.get(stockCode);
        matched.push({
          stockCode,
          corpCode: info.corpCode,
          corpName: info.corpName
        });
      } else {
        notFound.push(stockCode);
      }
    }

    console.log(`\n매칭 성공: ${matched.length}개`);
    console.log(`매칭 실패: ${notFound.length}개`);

    // 5. 하드코딩용 코드 생성
    let hardcodedCorpCodes = '// 전체 종목 corpCode 하드코딩 (자동 생성)\nconst knownCorpCodes = {\n';

    for (const item of matched) {
      hardcodedCorpCodes += `  '${item.stockCode}': { corpCode: '${item.corpCode}', corpName: '${item.corpName}' },\n`;
    }

    hardcodedCorpCodes += '};\n';

    // 파일로 저장
    fs.writeFileSync('./scripts/corpCodes_generated.js', hardcodedCorpCodes);
    console.log('\n생성된 파일: scripts/corpCodes_generated.js');

    // 매칭 실패 종목 출력
    if (notFound.length > 0) {
      console.log('\n매칭 실패 종목:');
      console.log(notFound.join(', '));
    }

    return { matched, notFound };

  } catch (error) {
    console.error('수집 실패:', error.message);
    throw error;
  }
}

collectCorpCodes().then(result => {
  console.log('\n수집 완료!');
}).catch(err => {
  console.error('오류:', err);
  process.exit(1);
});
