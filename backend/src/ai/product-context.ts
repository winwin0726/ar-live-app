export const CURRENT_LIVE_PRODUCT = {
  name: "오가닉 코튼 릴렉스핏 반팔 티셔츠",
  price: "29,000원",
  colors: ["블랙", "화이트", "오트밀", "스카이블루"],
  features: [
    "피부에 자극이 없는 100% 오가닉 순면 소재",
    "남녀노소 누구나 편안하게 입을 수 있는 릴렉스(오버) 핏",
    "세탁기 사용 가능 (건조기 사용 시 수축될 수 있으므로 자연건조 권장)",
    "넥라인 이중 봉제로 목 늘어남 방지"
  ],
  status: "현재 '오트밀' 색상 주문 폭주로 품절 임박",
  delivery: "오늘 자정 전 결제 시 내일 바로 출발 (로켓배송)"
};

export function getProductContextString(): string {
  return `
--- [현재 방송 중인 판매 상품 정보] ---
- 상품명: ${CURRENT_LIVE_PRODUCT.name}
- 가격: ${CURRENT_LIVE_PRODUCT.price}
- 옵션(색상): ${CURRENT_LIVE_PRODUCT.colors.join(', ')}
- 주요 특징 분석:
  ${CURRENT_LIVE_PRODUCT.features.map(f => '* ' + f).join('\n  ')}
- 방송 현황: ${CURRENT_LIVE_PRODUCT.status}
- 배송 정보: ${CURRENT_LIVE_PRODUCT.delivery}
---------------------------------------
`;
}
