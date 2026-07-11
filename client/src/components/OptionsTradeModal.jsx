import React, { useState } from 'react';

const LOT_SIZES = { NIFTY: 65, SENSEX: 20 };
const getLotSize = (index) => LOT_SIZES[index] || 1;

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export default function OptionsTradeModal({ optionData, action, onClose, onConfirm }) {
  const lotSize = getLotSize(optionData?.index);
  const [quantity, setQuantity] = useState('1');
  const [orderType, setOrderType] = useState('market'); // market or limit
  const [limitPrice, setLimitPrice] = useState(optionData?.ltp || 0);

  const rawQty = Math.max(1, parseInt(quantity) || 0);
  const contractName = `${optionData?.index} ${optionData?.strike} ${optionData?.type}`;
  const premium = optionData?.ltp || 0;
  const contracts = rawQty * lotSize;
  const totalValue = contracts * premium;

  const handleQuantityChange = (e) => {
    const val = e.target.value;
    if (val === '') { setQuantity(''); return; }
    const num = parseInt(val);
    if (!isNaN(num)) setQuantity(Math.max(1, num).toString());
  };

  const handleConfirm = () => {
    onConfirm({
      contract: contractName,
      action,
      quantity: rawQty,
      orderType,
      limitPrice: orderType === 'limit' ? limitPrice : premium,
      premium,
      totalValue,
      strike: optionData?.strike,
      type: optionData?.type,
      index: optionData?.index,
      expiry: optionData?.expiry
    });
  };

  return (
    <div className="trade-modal-overlay">
      <div className="trade-modal">
        <div className="trade-modal-header">
          <h3>{action.toUpperCase()} {contractName}</h3>
          <button className="trade-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="trade-modal-body">
          <div className="trade-info">
            <div className="trade-info-row">
              <span>Current Premium</span>
              <strong>{formatCurrency(premium)}</strong>
            </div>
            <div className="trade-info-row">
              <span>Expiry</span>
              <strong>{optionData?.expiry}</strong>
            </div>
            <div className="trade-info-row">
              <span>IV</span>
              <strong>{optionData?.iv}%</strong>
            </div>
          </div>

          <div className="trade-form">
            <div className="form-group">
              <label>Quantity (Lots)</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={handleQuantityChange}
                className="trade-input"
              />
              <small style={{ color: '#94a3b8', display: 'block', marginTop: '4px' }}>
                1 Lot = {lotSize} contracts
              </small>
            </div>

            <div className="form-group">
              <label>Order Type</label>
              <div className="order-type-selector">
                <button
                  className={`order-type-btn ${orderType === 'market' ? 'order-type-btn--active' : ''}`}
                  onClick={() => setOrderType('market')}
                >
                  Market Order
                </button>
                <button
                  className={`order-type-btn ${orderType === 'limit' ? 'order-type-btn--active' : ''}`}
                  onClick={() => setOrderType('limit')}
                >
                  Limit Order
                </button>
              </div>
            </div>

            {orderType === 'limit' && (
              <div className="form-group">
                <label>Limit Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
                  className="trade-input"
                />
              </div>
            )}

            <div className="trade-summary">
              <div className="summary-row">
                <span>Premium per Contract</span>
                <span>{formatCurrency(premium)}</span>
              </div>
              <div className="summary-row">
                <span>Contracts</span>
                <span>{contracts}</span>
              </div>
              <div className="summary-row summary-row--total">
                <span>Total Value</span>
                <strong>{formatCurrency(totalValue)}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="trade-modal-footer">
          <button className="trade-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button 
            className={`trade-confirm-btn trade-confirm-btn--${action}`}
            onClick={handleConfirm}
          >
            {action.toUpperCase()} {contractName}
          </button>
        </div>
      </div>
    </div>
  );
}
