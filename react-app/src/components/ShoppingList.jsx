import React, { useEffect, useState } from 'react'
import ShoppingListItem from './ShoppingListItem'

const STORAGE_KEY = 'shoppingList'

export default function ShoppingList(){
  const [list, setList] = useState([])
  const [newItem, setNewItem] = useState('')

  useEffect(()=>{
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      setList(raw ? JSON.parse(raw) : [])
    } catch(e){ setList([]) }
  },[])

  useEffect(()=>{
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch(e){}
  },[list])

  const addItem = () => {
    const name = newItem.trim()
    if (!name) return
    const id = Date.now().toString(36)
    setList(prev => [{ id, name, quantity: 1, checked: false }, ...prev])
    setNewItem('')
  }

  const removeItem = (id) => setList(prev => prev.filter(i => i.id !== id))
  const toggleChecked = (id) => setList(prev => prev.map(i => i.id===id ? { ...i, checked: !i.checked } : i))
  const updateQuantity = (id, qty) => setList(prev => prev.map(i => i.id===id ? { ...i, quantity: qty } : i))

  const clearAll = () => {
    if (!confirm('¿Vaciar la lista de la compra?')) return
    setList([])
  }

  return (
    <section className="shopping-list">
      <h2>📋 Mi Lista de la Compra</h2>

      <div className="shopping-controls">
        <input placeholder="Añadir producto..." value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=> e.key==='Enter' && addItem()} />
        <button onClick={addItem}>Añadir</button>
        <button onClick={clearAll}>Vaciar</button>
      </div>

      <div className="shopping-items">
        {list.length===0 ? (
          <div className="empty">Tu lista está vacía</div>
        ) : (
          list.map(item => (
            <ShoppingListItem key={item.id}
              item={item}
              onRemove={()=>removeItem(item.id)}
              onToggle={()=>toggleChecked(item.id)}
              onChangeQty={(q)=>updateQuantity(item.id,q)}
            />
          ))
        )}
      </div>
    </section>
  )
}
