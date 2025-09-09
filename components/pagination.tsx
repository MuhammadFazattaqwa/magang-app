"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPrevPage: () => void
  onNextPage: () => void
}

export function Pagination({ currentPage, totalPages, onPrevPage, onNextPage }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-4">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrevPage}
        disabled={currentPage === 1}
        className="flex items-center gap-2 bg-transparent"
      >
        <ChevronLeft className="h-4 w-4" />
        Sebelumnya
      </Button>

      <span className="text-sm text-gray-600">
        {currentPage}/{totalPages}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={onNextPage}
        disabled={currentPage === totalPages}
        className="flex items-center gap-2 bg-transparent"
      >
        Selanjutnya
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
