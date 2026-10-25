// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScrollStrip } from './ScrollStrip'

afterEach(cleanup)

/** jsdom lays nothing out: give the track a size, a content width and a scroll position */
function layout(el: HTMLElement, { width, content, scroll }: { width: number; content: number; scroll: number }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: content })
  el.scrollLeft = scroll
}

const strip = (dir: 'ltr' | 'rtl') =>
  render(
    <div dir={dir} style={{ direction: dir }}>
      <ScrollStrip className="bar" aria-label="tools">
        <button>a</button>
        <button>b</button>
      </ScrollStrip>
    </div>,
  )

const track = () => document.querySelector('.scroll-strip-track') as HTMLElement
const arrows = () => [...document.querySelectorAll('.scroll-strip-arrow')].map((a) => a.className.replace('scroll-strip-arrow ', ''))

describe('ScrollStrip', () => {
  it('shows no fade and no arrow when everything fits', () => {
    strip('ltr')
    layout(track(), { width: 300, content: 300, scroll: 0 })
    fireEvent.scroll(track())
    expect(arrows()).toEqual([])
    expect(track().className).toBe('scroll-strip-track')
    expect(screen.getByLabelText('tools').className).toBe('scroll-strip bar')
  })

  it('fades and points to the side that has more, and follows the scrolling', () => {
    strip('ltr')
    layout(track(), { width: 200, content: 500, scroll: 0 })
    fireEvent.scroll(track())
    expect(arrows()).toEqual(['right'])
    expect(track().classList.contains('fade-right')).toBe(true)
    layout(track(), { width: 200, content: 500, scroll: 150 })
    fireEvent.scroll(track())
    expect(arrows()).toEqual(['left', 'right'])
    layout(track(), { width: 200, content: 500, scroll: 300 })
    fireEvent.scroll(track())
    expect(arrows()).toEqual(['left'])
  })

  it('in right-to-left the row starts at the right, so the rest is to the left', () => {
    strip('rtl')
    layout(track(), { width: 200, content: 500, scroll: 0 })
    fireEvent.scroll(track())
    expect(arrows()).toEqual(['left'])
    layout(track(), { width: 200, content: 500, scroll: -300 })
    fireEvent.scroll(track())
    expect(arrows()).toEqual(['right'])
  })

  it('moves the row along when an arrow is tapped', () => {
    strip('ltr')
    layout(track(), { width: 200, content: 500, scroll: 0 })
    const scrollBy = vi.fn()
    track().scrollBy = scrollBy
    fireEvent.scroll(track())
    fireEvent.click(document.querySelector('.scroll-strip-arrow.right')!)
    expect(scrollBy).toHaveBeenCalledWith({ left: 140, behavior: 'smooth' })
  })
})
