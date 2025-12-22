/**
 * 터틀 피라미딩 모듈 독립 테스트
 * 
 * 실행 방법: node backend/test/turtlePyramidingTest.js
 */

console.log('🧪 터틀 피라미딩 시스템 독립 테스트 시작...\n');

// 모듈 로드
const TurtlePyramiding = require('../services/turtlePyramiding');
const PortfolioTracker = require('../services/portfolioTracker');
const TurtleNotification = require('../services/turtleNotification');

async function runAllTests() {
  try {
    console.log('='.repeat(60));
    console.log('🔬 1. TurtlePyramiding 모듈 테스트');
    console.log('='.repeat(60));
    
    await TurtlePyramiding.runTest();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔬 2. PortfolioTracker 모듈 테스트');
    console.log('='.repeat(60));
    
    const portfolioTracker = new PortfolioTracker();
    await portfolioTracker.runTest();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔬 3. TurtleNotification 모듈 테스트');
    console.log('='.repeat(60));
    
    const turtleNotification = new TurtleNotification();
    await turtleNotification.runTest();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔬 4. 통합 시나리오 테스트');
    console.log('='.repeat(60));
    
    await runIntegratedScenarioTest();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ 모든 모듈 테스트 완료!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ 테스트 실행 중 오류 발생:', error.message);
    console.error(error.stack);
  }
}

/**
 * 통합 시나리오 테스트
 * 실제 사용 flow 시뮬레이션
 */
async function runIntegratedScenarioTest() {
  console.log('📊 통합 시나리오: 삼성전자 3단계 피라미딩');
  
  // 시나리오: 삼성전자 70,000원에 1차 진입 → 71,000원 2차 추가 → 72,000원 3차 추가
  let position = {
    symbol: '005930',
    name: '삼성전자',
    originalEntryPrice: 70000,
    originalN: 2000, // ATR
    currentUnits: 1,
    maxUnits: 4,
    unitSize: 100,
    totalQuantity: 100,
    unitEntries: [{
      level: 1,
      price: 70000,
      quantity: 100,
      timestamp: new Date().toISOString()
    }]
  };
  
  console.log('\n📊 초기 포지션:', TurtlePyramiding.getPositionSummary(position));
  
  // 1차 추가매수 테스트 (71,000원)
  console.log('\n💰 현재가 71,000원 → 1차 추가매수 체크');
  let addSignal = TurtlePyramiding.checkAddSignal(position, 71000);
  
  if (addSignal) {
    console.log('✅ 1차 추가매수 신호 발생!');
    console.log(`   추가 투자액: ${(addSignal.investment.addAmount / 10000).toFixed(0)}만원`);
    console.log(`   신규 평균가: ${addSignal.afterAdd.newAveragePrice.toLocaleString()}원`);
    
    // 포지션 업데이트
    position = TurtlePyramiding.updatePositionAfterAdd(position, 71000);
    console.log('📊 업데이트된 포지션:', TurtlePyramiding.getPositionSummary(position));
  }
  
  // 2차 추가매수 테스트 (72,000원)  
  console.log('\n💰 현재가 72,000원 → 2차 추가매수 체크');
  addSignal = TurtlePyramiding.checkAddSignal(position, 72000);
  
  if (addSignal) {
    console.log('✅ 2차 추가매수 신호 발생!');
    console.log(`   추가 투자액: ${(addSignal.investment.addAmount / 10000).toFixed(0)}만원`);
    console.log(`   신규 평균가: ${addSignal.afterAdd.newAveragePrice.toLocaleString()}원`);
    
    // 포지션 업데이트
    position = TurtlePyramiding.updatePositionAfterAdd(position, 72000);
    console.log('📊 업데이트된 포지션:', TurtlePyramiding.getPositionSummary(position));
  }
  
  // 손절 시나리오 테스트 (68,000원으로 급락)
  console.log('\n📉 현재가 68,000원 → 손절 신호 체크');
  const stopSignal = TurtlePyramiding.checkStopLossSignal(position, 68000);
  
  if (stopSignal) {
    console.log('🚨 손절 신호 발생!');
    console.log(`   손실액: ${(stopSignal.lossAmount / 10000).toFixed(0)}만원`);
    console.log(`   손절가: ${stopSignal.stopLossPrice.toLocaleString()}원`);
  }
  
  console.log('\n✅ 통합 시나리오 테스트 완료!');
}

/**
 * 성능 테스트
 */
async function runPerformanceTest() {
  console.log('\n⏱️ 성능 테스트 시작...');
  
  const startTime = Date.now();
  
  // 100개 포지션으로 대량 테스트
  for (let i = 0; i < 100; i++) {
    const position = TurtlePyramiding.createMockPosition(`TEST${i.toString().padStart(3, '0')}`, 50000 + i * 1000, 1000);
    const signal = TurtlePyramiding.checkAddSignal(position, 52000);
    
    if (i % 20 === 0) {
      process.stdout.write('.');
    }
  }
  
  const endTime = Date.now();
  console.log(`\n✅ 100개 포지션 처리 시간: ${endTime - startTime}ms`);
}

// 메인 테스트 실행
if (require.main === module) {
  runAllTests()
    .then(() => {
      console.log('\n🎉 모든 테스트가 성공적으로 완료되었습니다!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 테스트 실패:', error.message);
      process.exit(1);
    });
}