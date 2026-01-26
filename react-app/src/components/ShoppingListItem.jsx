import React from 'react'

export default function ShoppingListItem({ item, onRemove, onToggle, onChangeQty }){
  return (
    <div className={`shopping-item ${item.checked ? 'done' : ''}`}>
      <input type="checkbox" checked={item.checked} onChange={onToggle} />
      <div className="item-main">
        <div className="item-name">{item.name}</div>
        <div className="item-controls">
          <input type="number" min="1" value={item.quantity} onChange={e=>onChangeQty(Number(e.target.value)||1)} />
          <button onClick={onRemove}>Eliminar</button>
        </div>
      </div>
    </div>
  )
}
