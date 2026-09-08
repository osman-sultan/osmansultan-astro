import { useEffect, useState } from "react"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const linkClass =
  "text-link underline underline-offset-4 transition-opacity hover:opacity-70"

const description =
  "Atrios pays people to recommend products to their friends. Companies that want customers list themselves on Atrios; a well-connected person sees one, thinks of a friend who needs it, and makes the introduction."

const HOVER_QUERY = "(hover: hover) and (pointer: fine)"

// True on mouse/trackpad devices, false on touch. Starts true so the server
// render and first client render match, then corrects itself after mount.
function useCanHover() {
  const [canHover, setCanHover] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia(HOVER_QUERY)
    const update = () => setCanHover(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return canHover
}

/**
 * "Atrios" inline. With a mouse: hover previews what the company does and
 * click opens atrios.com. On touch, where hover doesn't exist: tap opens a
 * popover with the same text and a link to the site.
 */
export function AtriosCard() {
  const canHover = useCanHover()

  if (!canHover) {
    return (
      <Popover>
        <PopoverTrigger className={`cursor-pointer ${linkClass}`}>
          Atrios
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-72 text-xs/relaxed"
        >
          <p>{description}</p>
          <p className="mt-2">
            <a
              href="https://atrios.com"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Visit atrios.com
            </a>
          </p>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={120}
        closeDelay={200}
        href="https://atrios.com"
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        Atrios
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start">
        <p>{description}</p>
      </HoverCardContent>
    </HoverCard>
  )
}
