"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TechnicianHeader } from "@/components/technician-header"

export default function ComplainPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const jobId = searchParams.get("job") || "001"

  const [complaintType, setComplaintType] = useState("")
  const [complaintText, setComplaintText] = useState("")
  const [technicianName, setTechnicianName] = useState("Ahmad Teknisi")

  useEffect(() => {
    // Get technician name from localStorage or use default
    const storedName = localStorage.getItem("technicianName") || "Ahmad Teknisi"
    setTechnicianName(storedName)
  }, [])

  useEffect(() => {
    if (complaintType === "salah-lokasi") {
      setComplaintText(
        `Halo Admin, saya ${technicianName} dengan ID pekerjaan ${jobId} melaporkan bahwa saya dikirim ke lokasi yang salah. Lokasi saat ini: [LOKASI_SAAT_INI]. Seharusnya: [LOKASI_SEHARUSNYA]. Mohon tindak lanjut.`,
      )
    } else if (complaintType === "") {
      setComplaintText("")
    }
  }, [complaintType, jobId, technicianName])

  const handleSubmitComplaint = () => {
    if (!complaintType || !complaintText.trim()) {
      return
    }

    // URL encode the message
    const encodedMessage = encodeURIComponent(complaintText)

    // Admin WhatsApp number (placeholder)
    const adminWhatsAppNumber = "628889110230"

    // Open WhatsApp with pre-filled message
    const whatsappUrl = `https://wa.me/${adminWhatsAppNumber}?text=${encodedMessage}`
    window.open(whatsappUrl, "_blank")
  }

  const isFormValid = complaintType && complaintText.trim()

  return (
    <div className="min-h-screen bg-gray-50">
      <TechnicianHeader title="Ajukan Komplain" showBackButton={true} backUrl="/user/dashboard" />

      {/* Main Content */}
      <main className="p-4">
        <div className="max-w-md mx-auto">
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* Complaint Type Dropdown */}
              <div className="space-y-2">
                <Label htmlFor="complaint-type">Ajuan Komplain</Label>
                <Select value={complaintType} onValueChange={setComplaintType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih tipe komplain" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="salah-lokasi">Salah Lokasi</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Complaint Text Field */}
              <div className="space-y-2">
                <Label htmlFor="complaint-text">Alasan</Label>
                <Textarea
                  id="complaint-text"
                  value={complaintText}
                  onChange={(e) => setComplaintText(e.target.value)}
                  className="min-h-[200px] resize-none"
                  placeholder="Tulis alasan Anda..."
                />
              </div>

              {/* Submit Button */}
              <Button
                onClick={handleSubmitComplaint}
                disabled={!isFormValid}
                className="w-full bg-green-600 hover:bg-green-700 text-white"
              >
                Kirim Ajuan Komplain
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
