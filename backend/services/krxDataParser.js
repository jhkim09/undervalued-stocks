/**
 * KRX 상장사 데이터 파싱 서비스
 * 한국거래소에서 제공하는 정확한 상장사 목록 활용
 */

const fs = require('fs');
const path = require('path');

class KrxDataParser {
  
  // KRX CSV 파일 파싱
  async parseKrxCsvFile(csvFilePath) {
    try {
      console.log('📊 KRX 상장사 CSV 파일 파싱 시작...');
      
      // CSV 파일 읽기 (한글 인코딩 처리)
      let csvContent;
      try {
        csvContent = fs.readFileSync(csvFilePath, 'utf8');
      } catch {
        // UTF-8이 안되면 EUC-KR로 시도
        const iconv = require('iconv-lite');
        const buffer = fs.readFileSync(csvFilePath);
        csvContent = iconv.decode(buffer, 'euc-kr');
      }
      
      // 간단한 CSV 파싱 (csv-parse 없이)
      const lines = csvContent.split('\n').filter(line => line.trim());
      const records = [];
      
      // 첫 번째 줄은 헤더이므로 건너뛰기
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // CSV 파싱 (따옴표 처리)
        const columns = line.split(',').map(col => col.replace(/^"|"$/g, '').trim());
        
        if (columns.length >= 3) {
          records.push({
            stockCode: columns[0],
            companyName: columns[1], 
            market: columns[2],
            sector: columns[3] || '',
            corpCode: columns[5] || ''
          });
        }
      }
      
      console.log(`📋 CSV에서 ${records.length}개 레코드 파싱 완료`);
      
      const listedCompanies = new Map();
      let validCount = 0;
      let skippedCount = 0;
      
      for (const record of records) {
        const stockCode = record.stockCode;
        const companyName = record.companyName;
        const market = record.market;
        const sector = record.sector;
        
        // 유효한 데이터 검증
        if (!stockCode || !companyName || !/^\d{6}$/.test(stockCode)) {
          skippedCount++;
          continue;
        }
        
        // SPAC, 우선주 등 제외
        if (companyName.includes('SPAC') || 
            companyName.includes('우선주') || 
            companyName.includes('신주인수권') ||
            sector?.includes('SPAC')) {
          skippedCount++;
          continue;
        }
        
        listedCompanies.set(stockCode, {
          stockCode: stockCode,
          companyName: companyName,
          market: market === 'KOSPI' ? 'KOSPI' : 'KOSDAQ',
          sector: sector || '',
          dataSource: 'KRX_CSV'
        });
        
        validCount++;
      }
      
      console.log(`✅ KRX 상장사 파싱 완료: ${validCount}개 유효, ${skippedCount}개 제외`);
      
      // 샘플 출력
      const samples = Array.from(listedCompanies.entries()).slice(0, 5);
      samples.forEach(([code, info]) => {
        console.log(`📝 샘플: ${code} → ${info.companyName} (${info.market})`);
      });
      
      return listedCompanies;
      
    } catch (error) {
      console.error('❌ KRX CSV 파싱 실패:', error.message);
      throw error;
    }
  }
  
  // KRX 데이터로 종목명 캐시 업데이트
  async updateStockNamesFromKrx(csvFilePath) {
    try {
      const StockNameCacheService = require('./stockNameCacheService');
      const StockName = require('../models/StockName');
      
      // CSV 파싱
      const listedCompanies = await this.parseKrxCsvFile(csvFilePath);
      
      let saved = 0;
      let updated = 0;
      let skipped = 0;
      
      console.log(`🚀 ${listedCompanies.size}개 KRX 상장사 데이터를 DB에 저장 시작...`);
      
      for (const [stockCode, companyInfo] of listedCompanies) {
        try {
          // DB에서 기존 데이터 확인
          const existing = await StockName.findOne({ stockCode });
          
          if (existing) {
            // 기존 데이터 업데이트 (KRX 데이터가 더 정확하므로 우선)
            await StockName.updateOne(
              { stockCode },
              { 
                $set: { 
                  companyName: companyInfo.companyName,
                  market: companyInfo.market,
                  industry: companyInfo.sector,
                  lastUpdated: new Date(),
                  dataSource: 'KRX_CSV'
                }
              }
            );
            updated++;
          } else {
            // 신규 데이터 저장
            await StockName.saveStockName(stockCode, companyInfo.companyName, {
              market: companyInfo.market,
              industry: companyInfo.sector,
              dataSource: 'KRX_CSV'
            });
            saved++;
          }
          
          // 메모리 캐시에도 저장
          StockNameCacheService.memoryCache.set(stockCode, companyInfo.companyName);
          
          // 진행률 표시 (100개마다)
          if ((saved + updated) % 100 === 0) {
            console.log(`📈 KRX 업데이트 진행률: ${saved + updated}/${listedCompanies.size}`);
          }
          
        } catch (error) {
          console.error(`❌ ${stockCode} KRX 업데이트 실패:`, error.message);
          skipped++;
        }
      }
      
      console.log(`✅ KRX 상장사 데이터 업데이트 완료:`);
      console.log(`   신규: ${saved}개`);
      console.log(`   업데이트: ${updated}개`);
      console.log(`   건너뜀: ${skipped}개`);
      
      return { saved, updated, skipped, total: listedCompanies.size };
      
    } catch (error) {
      console.error('❌ KRX 데이터 업데이트 실패:', error.message);
      throw error;
    }
  }
}

module.exports = new KrxDataParser();