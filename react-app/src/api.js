export async function apiGet(path){
  try{
    const res = await fetch(path, { credentials: 'same-origin' })
    if (!res.ok) throw new Error('Network error')
    return await res.json()
  }catch(e){ throw e }
}

export async function apiPost(path, body){
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error('Network error')
  return await res.json()
}
