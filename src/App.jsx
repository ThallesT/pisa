import { useEffect, useMemo, useState } from 'react'
import {MEDICINES} from './assets/medicine.js'
import './App.css'
import { useLocalStorageJSON } from './lib/memory.js'
import * as XLSX from 'xlsx'

const VETS_DEFAULT = [
  'Isadora',
  'Thalles'
]

function formatDateTime(d = new Date()) {
  const pad = (n) => n.toString().padStart(2, '0')
  const day = pad(d.getDate())
  const month = pad(d.getMonth() + 1)
  const year = d.getFullYear()
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${day}/${month}/${year} ${hh}:${mm}`
}

// Helper: format timestamp/date to input[type="datetime-local"] value (yyyy-MM-ddTHH:mm)
function toLocalInputValue(tsOrDate = Date.now()) {
  const d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => n.toString().padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

// Helper: parse input[type="datetime-local"] string to timestamp (ms)
function parseLocalInputToMs(str) {
  if (!str) return NaN
  const dt = new Date(str)
  const t = dt.getTime()
  return isNaN(t) ? NaN : t
}

// Util: parse dd/mm/yyyy hh:mm into a Date (fallback for legacy items)
function parseFormattedDateTime(str) {
  if (!str || typeof str !== 'string') return null
  const [datePart, timePart] = str.split(' ')
  if (!datePart) return null
  const [dd, mm, yyyy] = datePart.split('/').map((v) => parseInt(v, 10))
  let hh = 0
  let mi = 0
  if (timePart) {
    const [h, m] = timePart.split(':').map((v) => parseInt(v, 10))
    hh = isNaN(h) ? 0 : h
    mi = isNaN(m) ? 0 : m
  }
  const dt = new Date(yyyy, (mm || 1) - 1, dd || 1, hh, mi, 0, 0)
  return isNaN(dt.getTime()) ? null : dt
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function getTodayRange(now = new Date()) {
  return { start: startOfDay(now), end: endOfDay(now) }
}
function getMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  return { start, end }
}
function getWeekMonFriRange(now = new Date()) {
  const day = now.getDay() // 0=Sun,1=Mon
  const diffToMon = day === 0 ? -6 : 1 - day
  const monday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon))
  const friday = endOfDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4))
  return { start: monday, end: friday }
}

// Quantos dias entre duas datas (yyyy-mm-dd) considerando inclusive (ex: 2025-10-01 a 2025-10-01 = 1 dia)
function daysBetweenInclusive(startISO, endISO) {
  if (!startISO && !endISO) return 0
  const dayMs = 24 * 60 * 60 * 1000
  const sDate = startOfDay(new Date(startISO || endISO))
  const eDate = endOfDay(new Date(endISO || startISO))
  let s = sDate.getTime()
  let e = eDate.getTime()
  if (e < s) {
    // inverte se vier trocado
    const s2 = startOfDay(new Date(endISO || startISO)).getTime()
    const e2 = endOfDay(new Date(startISO || endISO)).getTime()
    s = Math.min(s2, e2)
    e = Math.max(s2, e2)
  }
  const ms = e - s
  return Math.floor(ms / dayMs) + 1
}

function getLastNDaysRange(now = new Date(), n = 1) {
  const end = endOfDay(now)
  const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1)))
  return { start, end }
}

// Helper: list all days (Date objects) within range inclusive
function listDaysInRange(start, end) {
  const days = []
  const d = startOfDay(start)
  const e = startOfDay(end)
  for (let cur = new Date(d); cur <= e; cur.setDate(cur.getDate() + 1)) {
    days.push(new Date(cur))
  }
  return days
}

function pad2(n) { return n.toString().padStart(2, '0') }
function fmtMDY(d) {
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const yy = d.getFullYear().toString().slice(-2)
  return `${mm}-${dd}-${yy}`
}
function fmtDMY(d) {
  const dd = pad2(d.getDate())
  const mm = pad2(d.getMonth() + 1)
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
function isoKey(d) {
  // local date key yyyy-mm-dd
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function App() {
  // Memory-backed lists
  const [items, setItems] = useLocalStorageJSON('records', [])
  const [petsList, setPetsList] = useLocalStorageJSON('pets', [])
  const [vetsList] = useLocalStorageJSON('vets', VETS_DEFAULT)

  // Form state
  const [pet, setPet] = useState('')
  const [petOpen, setPetOpen] = useState(false)
  const [medicineInput, setMedicineInput] = useState('') // campo livre com dropdown
  const [medicineOpen, setMedicineOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [vet, setVet] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDateTime, setEditDateTime] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // Filtro por período
  const [filterMode, setFilterMode] = useState('today') // 'month' | 'week' | 'today' | 'custom' | 'lastN'
  const [customStart, setCustomStart] = useState('') // yyyy-mm-dd
  const [customEnd, setCustomEnd] = useState('') // yyyy-mm-dd
  const [lastCustomDays, setLastCustomDays] = useState(() => {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem('lastCustomDays') : null
    const n = s != null ? parseInt(s, 10) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  })

  // Download modal state
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [dlMode, setDlMode] = useState('today') // mirrors filter modes
  const [dlStart, setDlStart] = useState('')
  const [dlEnd, setDlEnd] = useState('')

  const filteredMedicines = useMemo(() => {
    const s = medicineInput.trim().toLowerCase()
    if (!s) return MEDICINES
    return MEDICINES.filter((m) => m.toLowerCase().includes(s))
  }, [medicineInput])

  const filteredPets = useMemo(() => {
    const s = pet.trim().toLowerCase()
    if (!s) return petsList
    return petsList.filter((p) => p.toLowerCase().includes(s))
  }, [pet, petsList])

  function resetForm() {
    setPet('')
    setMedicineInput('')
    setQuantity(1)
    setVet(vetsList[0] || '')
    setMedicineOpen(false)
    setPetOpen(false)
    setEditingId(null)
    setEditDateTime('')
  }

  function saveOrAdd() {
    if (!pet || !medicineInput || !vet || !quantity) return
    const petName = pet.trim()
    if (editingId) {
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== editingId) return it
          // compute new timestamp from input
          const parsedMs = parseLocalInputToMs(editDateTime)
          const newCreatedAt = Number.isFinite(parsedMs)
            ? parsedMs
            : (it.createdAt ?? (parseFormattedDateTime(it.date)?.getTime() ?? Date.now()))
          return {
            ...it,
            pet,
            medicine: medicineInput,
            vet,
            quantity: Number(quantity),
            createdAt: newCreatedAt,
            date: formatDateTime(new Date(newCreatedAt)),
          }
        })
      )
      if (petName) {
        setPetsList((prev) => (prev.includes(petName) ? prev : [petName, ...prev]))
      }
      resetForm()
      return
    }
    setItems((prev) => [
      { id: crypto.randomUUID(), createdAt: Date.now(), date: formatDateTime(), pet, medicine: medicineInput, vet, quantity: Number(quantity) },
      ...prev,
    ])
    if (petName) {
      setPetsList((prev) => (prev.includes(petName) ? prev : [petName, ...prev]))
    }
    resetForm()
  }

  const canAdd = pet.trim() && medicineInput.trim() && vet.trim() && Number(quantity) > 0

  // Ensure vet defaults to first available option from memory
  useEffect(() => {
    if ((!vet && vetsList.length > 0) || (vet && !vetsList.includes(vet))) {
      setVet(vetsList[0] || '')
    }
  }, [vetsList, vet])

  function startEdit(row) {
    setPet(row.pet)
    setMedicineInput(row.medicine)
    setQuantity(row.quantity)
    setVet(row.vet)
    setEditingId(row.id)
    const ts = row.createdAt ?? (parseFormattedDateTime(row.date)?.getTime() ?? Date.now())
    setEditDateTime(toLocalInputValue(ts))
    setMedicineOpen(false)
  }

  function deleteItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (editingId === id) {
      resetForm()
    }
  }

  function requestDelete(id) {
    setConfirmDeleteId(id)
  }

  function confirmDelete() {
    if (!confirmDeleteId) return
    deleteItem(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  function cancelDelete() {
    setConfirmDeleteId(null)
  }

  // Range ativo conforme filtro
  const activeRange = useMemo(() => {
    const now = new Date()
    if (filterMode === 'month') return getMonthRange(now)
    if (filterMode === 'week') return getWeekMonFriRange(now)
    if (filterMode === 'lastN') {
      const n = Number(lastCustomDays)
      if (Number.isFinite(n) && n > 0) return getLastNDaysRange(now, n)
      return getTodayRange(now)
    }
    if (filterMode === 'custom') {
      let start = customStart ? startOfDay(new Date(customStart)) : null
      let end = customEnd ? endOfDay(new Date(customEnd)) : null
      // Se nenhum definido, default para hoje
      if (!start && !end) return getTodayRange(now)
      if (!start) start = new Date(0)
      if (!end) end = new Date(8640000000000000) // max date
      // normaliza se invertido
      if (end < start) {
        const tmp = start
        start = startOfDay(new Date(end))
        end = endOfDay(new Date(tmp))
      }
      return { start, end }
    }
    // default hoje
    return getTodayRange(now)
  }, [filterMode, customStart, customEnd, lastCustomDays])

  function getItemTime(it) {
    if (it.createdAt) return it.createdAt
    const parsed = parseFormattedDateTime(it.date)
    return parsed ? parsed.getTime() : 0
  }

  const filteredItems = useMemo(() => {
    const { start, end } = activeRange
    const s = start.getTime()
    const e = end.getTime()
    return items.filter((it) => {
      const t = getItemTime(it)
      return t >= s && t <= e
    })
  }, [items, activeRange])

  // Days list for current active range
  const activeDays = useMemo(() => listDaysInRange(activeRange.start, activeRange.end), [activeRange])

  // Download modal computed range and days
  const dlRange = useMemo(() => {
    const now = new Date()
    if (dlMode === 'month') return getMonthRange(now)
    if (dlMode === 'week') return getWeekMonFriRange(now)
    if (dlMode === 'lastN') {
      const n = Number(lastCustomDays)
      if (Number.isFinite(n) && n > 0) return getLastNDaysRange(now, n)
      return getTodayRange(now)
    }
    if (dlMode === 'custom') {
      let start = dlStart ? startOfDay(new Date(dlStart)) : null
      let end = dlEnd ? endOfDay(new Date(dlEnd)) : null
      if (!start && !end) return getTodayRange(now)
      if (!start) start = new Date(0)
      if (!end) end = new Date(8640000000000000)
      if (end < start) {
        const tmp = start
        start = startOfDay(new Date(end))
        end = endOfDay(new Date(tmp))
      }
      return { start, end }
    }
    return getTodayRange(now)
  }, [dlMode, dlStart, dlEnd, lastCustomDays])

  const dlDays = useMemo(() => listDaysInRange(dlRange.start, dlRange.end), [dlRange])

  function exportXLSXForRange(range) {
    try {
      const days = listDaysInRange(range.start, range.end)
      if (!days || days.length === 0) return

      const headers = ['name', ...days.map((d) => fmtMDY(d))]
      const aoa = [headers]

      // Build a map: key = medicine|yyyy-mm-dd => array of "pet - vet"
      const cellMap = new Map()
      const s = range.start.getTime()
      const e = range.end.getTime()
      for (const it of items) {
        const t = getItemTime(it)
        if (t < s || t > e) continue
        const d = new Date(t)
        const key = `${it.medicine}|${isoKey(d)}`
        const val = `${it.pet} - ${it.vet}`
        if (!cellMap.has(key)) cellMap.set(key, [val])
        else cellMap.get(key).push(val)
      }

      for (const med of MEDICINES) {
        const row = [med]
        for (const d of days) {
          const k = `${med}|${isoKey(d)}`
          const values = cellMap.get(k) || []
          // Join multiple entries with line breaks
          row.push(values.join('\n'))
        }
        aoa.push(row)
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa)
      // Optional: set column widths a bit
      const colWidths = headers.map((h, idx) => ({ wch: idx === 0 ? 28 : 12 }))
      ws['!cols'] = colWidths

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Registros')

      // Filename with period
      const first = days[0]
      const last = days[days.length - 1]
      const fname = `registros_${fmtMDY(first)}_a_${fmtMDY(last)}.xlsx`
      XLSX.writeFile(wb, fname)
    } catch (e) {
      console.error('Erro ao exportar XLSX', e)
      alert('Falha ao gerar o XLSX. Veja o console para detalhes.')
    }
  }

  function handleDownload() {
    // Abrir modal de seleção de período para download
    try {
      // inicializa com o período atual do filtro
      setDlMode(filterMode)
      if (filterMode === 'custom') {
        setDlStart(customStart)
        setDlEnd(customEnd)
      } else {
        // zera datas custom da modal
        setDlStart('')
        setDlEnd('')
      }
      setDownloadOpen(true)
    } catch (e) {
      console.error('Erro ao preparar modal de download', e)
    }
  }

  const pendingDelete = confirmDeleteId ? items.find((it) => it.id === confirmDeleteId) : null

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">I.S.A.D.O.R.A.</h1>
        <h4 className="font-light italic mb-12">Intelligent System for Animal Data, Organization, Registry & Assistance</h4>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
          {/* Pet Name with suggestions */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium mb-1">Pet name</label>
            <div className="relative">
              <input
                type="text"
                value={pet}
                onChange={(e) => {
                  setPet(e.target.value)
                  if (!petOpen) setPetOpen(true)
                }}
                onFocus={() => setPetOpen(true)}
                onBlur={() => setTimeout(() => setPetOpen(false), 120)}
                placeholder="Ex: Thor"
                className="w-full rounded-full border border-gray-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {petOpen && filteredPets.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 max-h-52 overflow-auto rounded-xl border border-gray-200 bg-white shadow z-10">
                  <ul className="py-1">
                    {filteredPets.map((p) => (
                      <li
                        key={p}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-50"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setPet(p)
                          setPetOpen(false)
                        }}
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Edit Date/Time (visible only when editing) */}
          {editingId && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Data e hora</label>
              <input
                type="datetime-local"
                value={editDateTime}
                onChange={(e) => setEditDateTime(e.target.value)}
                className="w-full rounded-full border border-gray-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Medicine: input with dropdown list */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Medicine</label>
            <div className="relative">
              <input
                type="text"
                value={medicineInput}
                onChange={(e) => {
                  setMedicineInput(e.target.value)
                  if (!medicineOpen) setMedicineOpen(true)
                }}
                onFocus={() => setMedicineOpen(true)}
                onBlur={() => setTimeout(() => setMedicineOpen(false), 120)}
                placeholder="Digite para buscar..."
                className="w-full rounded-full border border-gray-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {medicineOpen && (
                <div className="absolute left-0 right-0 mt-1 max-h-52 overflow-auto rounded-xl border border-gray-200 bg-white shadow z-10">
                  {filteredMedicines.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Nenhum resultado</div>
                  ) : (
                    <ul className="py-1">
                      {filteredMedicines.map((m) => (
                        <li
                          key={m}
                          className="px-3 py-2 cursor-pointer hover:bg-blue-50"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setMedicineInput(m)
                            setMedicineOpen(false)
                          }}
                        >
                          {m}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quantity */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-full border border-gray-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Vet */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium mb-1">Vet</label>
            <select
              value={vet}
              onChange={(e) => setVet(e.target.value)}
              className="w-full rounded-full border border-gray-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled hidden>
                Selecione o veterinário
              </option>
              {vetsList.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Add/Save buttons */}
          <div className="md:col-span-5 flex justify-end gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center rounded-full bg-gray-200 text-gray-800 px-4 py-2 shadow hover:bg-gray-300 transition"
                title="Cancelar edição"
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={saveOrAdd}
              disabled={!canAdd}
              className="inline-flex items-center rounded-full bg-blue-600 text-white px-4 py-2 shadow disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition"
              title={editingId ? 'Salvar' : 'Adicionar'}
            >
              <span className="text-xl leading-none mr-1">{editingId ? '✓' : '+'}</span>
              {editingId ? 'Salvar' : 'Adicionar'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-8">
          {/* Barra de filtros por data */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterMode('month')}
              className={`${filterMode==='month' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
            >
              Mês atual
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('week')}
              className={`${filterMode==='week' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
            >
              Semana (seg–sex)
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('today')}
              className={`${filterMode==='today' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
            >
              Hoje
            </button>
            {lastCustomDays ? (
              <button
                type="button"
                onClick={() => setFilterMode('lastN')}
                className={`${filterMode==='lastN' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
                title={`Último período personalizado: ${lastCustomDays} dias`}
              >
                {lastCustomDays} dias
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setFilterMode('custom')}
              className={`${filterMode==='custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
            >
              Personalizado
            </button>

            {filterMode==='custom' && (
              <div className="flex flex-wrap items-center gap-2 ml-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-full border border-gray-300 px-3 py-1.5"
                />
                <span className="text-gray-500">até</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-full border border-gray-300 px-3 py-1.5"
                />
                <button
                  type="button"
                  onClick={() => {
                    let s = customStart
                    let e = customEnd
                    if (!s && !e) {
                      const t = new Date()
                      const iso = t.toISOString().slice(0, 10)
                      s = iso
                      e = iso
                      setCustomStart(iso)
                      setCustomEnd(iso)
                    }
                    // calcula e persiste quantidade de dias
                    const n = daysBetweenInclusive(s, e)
                    if (Number.isFinite(n) && n > 0) {
                      setLastCustomDays(n)
                      try { localStorage.setItem('lastCustomDays', String(n)) } catch {}
                    }
                  }}
                  className="px-3 py-1.5 rounded-full bg-green-600 text-white"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomStart('')
                    setCustomEnd('')
                  }}
                  className="px-3 py-1.5 rounded-full bg-gray-200 text-gray-800"
                >
                  Limpar
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={handleDownload}
              disabled={activeDays.length === 0}
              className="ml-auto px-3 py-1.5 rounded-full bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700"
              title="Baixar XLSX do período atual"
            >
              Download Excel
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-left">
              <thead className="bg-gray-50 text-sm text-gray-600">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Pet</th>
                  <th className="px-4 py-3">Medicine</th>
                  <th className="px-4 py-3">Vet</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                      Nenhum registro para o período selecionado.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">{row.date}</td>
                      <td className="px-4 py-3">{row.pet}</td>
                      <td className="px-4 py-3">{row.medicine}</td>
                      <td className="px-4 py-3">{row.vet}</td>
                      <td className="px-4 py-3">{row.quantity}</td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="px-3 py-1 rounded-full text-xs bg-amber-100 text-amber-800 hover:bg-amber-200"
                            title="Editar"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(row.id)}
                            className="px-3 py-1 rounded-full text-xs bg-red-100 text-red-800 hover:bg-red-200"
                            title="Apagar"
                          >
                            Apagar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Download Period Modal */}
      {downloadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDownloadOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl border border-gray-200">
            <div className="text-center">
              <h3 className="text-lg font-semibold">Exportar XLSX</h3>
              <p className="text-sm text-gray-600 mt-1">
                Período selecionado: <span className="font-medium">{fmtDMY(dlRange.start)} até {fmtDMY(dlRange.end)}</span> ({dlDays.length} dia{dlDays.length === 1 ? '' : 's'})
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDlMode('month')}
                className={`${dlMode==='month' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
              >
                Mês atual
              </button>
              <button
                type="button"
                onClick={() => setDlMode('week')}
                className={`${dlMode==='week' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
              >
                Semana (seg–sex)
              </button>
              <button
                type="button"
                onClick={() => setDlMode('today')}
                className={`${dlMode==='today' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
              >
                Hoje
              </button>
              {lastCustomDays ? (
                <button
                  type="button"
                  onClick={() => setDlMode('lastN')}
                  className={`${dlMode==='lastN' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
                  title={`Último período personalizado: ${lastCustomDays} dias`}
                >
                  {lastCustomDays} dias
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDlMode('custom')}
                className={`${dlMode==='custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'} px-3 py-1.5 rounded-full border`}
              >
                Personalizado
              </button>

              {dlMode==='custom' && (
                <div className="flex flex-wrap items-center gap-2 ml-2">
                  <input
                    type="date"
                    value={dlStart}
                    onChange={(e) => setDlStart(e.target.value)}
                    className="rounded-full border border-gray-300 px-3 py-1.5"
                  />
                  <span className="text-gray-500">até</span>
                  <input
                    type="date"
                    value={dlEnd}
                    onChange={(e) => setDlEnd(e.target.value)}
                    className="rounded-full border border-gray-300 px-3 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      let s = dlStart
                      let e = dlEnd
                      if (!s && !e) {
                        const t = new Date()
                        const iso = t.toISOString().slice(0, 10)
                        s = iso
                        e = iso
                        setDlStart(iso)
                        setDlEnd(iso)
                      }
                      const n = daysBetweenInclusive(s, e)
                      if (Number.isFinite(n) && n > 0) {
                        setLastCustomDays(n)
                        try { localStorage.setItem('lastCustomDays', String(n)) } catch {}
                      }
                    }}
                    className="px-3 py-1.5 rounded-full bg-green-600 text-white"
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDlStart('')
                      setDlEnd('')
                    }}
                    className="px-3 py-1.5 rounded-full bg-gray-200 text-gray-800"
                  >
                    Limpar
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDownloadOpen(false)}
                className="px-4 py-2 rounded-full bg-gray-200 text-gray-800 hover:bg-gray-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={dlDays.length === 0}
                onClick={() => { exportXLSXForRange(dlRange); setDownloadOpen(false) }}
                className="px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cancelDelete} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-gray-200">
            <h3 className="text-lg font-semibold mb-2">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja apagar este registro?
            </p>
            {pendingDelete && (
              <div className="mb-4 text-sm bg-gray-50 border border-gray-200 rounded-xl p-3">
                <div><span className="text-gray-500">Data:</span> {pendingDelete.date}</div>
                <div><span className="text-gray-500">Pet:</span> {pendingDelete.pet}</div>
                <div><span className="text-gray-500">Medicina:</span> {pendingDelete.medicine}</div>
                <div><span className="text-gray-500">Vet:</span> {pendingDelete.vet}</div>
                <div><span className="text-gray-500">Quantidade:</span> {pendingDelete.quantity}</div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                className="px-4 py-2 rounded-full bg-gray-200 text-gray-800 hover:bg-gray-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-2 rounded-full bg-red-600 text-white hover:bg-red-700"
              >
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
