import React from 'react'
import ShoppingList from './components/ShoppingList'

export default function App(){
  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Mercadona Productos — React (demo)</h1>
      </header>
      <main>
        <ShoppingList />
      </main>
    </div>
  )
}
