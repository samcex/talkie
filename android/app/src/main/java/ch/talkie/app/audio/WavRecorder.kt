package ch.talkie.app.audio

import livekit.org.webrtc.AudioTrackSink
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

class WavRecorder(val file: File) : AudioTrackSink {
    private val raf = RandomAccessFile(file, "rw")
    private var sampleRate = 48_000
    private var channels = 1
    private var bitsPerSample = 16
    private var dataSize = 0L
    private val running = AtomicBoolean(true)
    val startedAt: Long = System.currentTimeMillis()

    init {
        synchronized(raf) {
            raf.write(ByteArray(HEADER_SIZE))
        }
    }

    override fun onData(
        audioData: ByteBuffer,
        bitsPerSample: Int,
        sampleRate: Int,
        numberOfChannels: Int,
        numberOfFrames: Int,
        absoluteCaptureTimestampMs: Long,
    ) {
        if (!running.get()) return
        val bytes = ByteArray(audioData.remaining())
        audioData.get(bytes)
        synchronized(raf) {
            if (!running.get()) return
            this.bitsPerSample = bitsPerSample
            this.sampleRate = sampleRate
            this.channels = numberOfChannels
            raf.write(bytes)
            dataSize += bytes.size
        }
    }

    fun finish(): Long {
        synchronized(raf) {
            if (!running.compareAndSet(true, false)) return durationMs()
            try {
                raf.seek(0)
                raf.write(buildHeader())
            } finally {
                raf.close()
            }
            return durationMs()
        }
    }

    fun cancel() {
        synchronized(raf) {
            running.set(false)
            try {
                raf.close()
            } catch (_: Exception) {}
        }
        try {
            file.delete()
        } catch (_: Exception) {}
    }

    private fun durationMs(): Long {
        val bytesPerSample = (bitsPerSample / 8).coerceAtLeast(1)
        val totalSamples = dataSize / (bytesPerSample * channels.coerceAtLeast(1))
        return (totalSamples * 1000L) / sampleRate.coerceAtLeast(1)
    }

    private fun buildHeader(): ByteArray {
        val byteRate = sampleRate * channels * (bitsPerSample / 8)
        val blockAlign = channels * (bitsPerSample / 8)
        val totalSize = (dataSize + 36).toInt()
        val out = ByteArray(HEADER_SIZE)
        write(out, 0, "RIFF")
        writeIntLe(out, 4, totalSize)
        write(out, 8, "WAVE")
        write(out, 12, "fmt ")
        writeIntLe(out, 16, 16)
        writeShortLe(out, 20, 1)
        writeShortLe(out, 22, channels.toShort())
        writeIntLe(out, 24, sampleRate)
        writeIntLe(out, 28, byteRate)
        writeShortLe(out, 32, blockAlign.toShort())
        writeShortLe(out, 34, bitsPerSample.toShort())
        write(out, 36, "data")
        writeIntLe(out, 40, dataSize.toInt())
        return out
    }

    private fun write(dst: ByteArray, offset: Int, s: String) {
        val bytes = s.toByteArray(Charsets.US_ASCII)
        System.arraycopy(bytes, 0, dst, offset, bytes.size)
    }

    private fun writeIntLe(dst: ByteArray, offset: Int, v: Int) {
        dst[offset] = (v and 0xFF).toByte()
        dst[offset + 1] = ((v ushr 8) and 0xFF).toByte()
        dst[offset + 2] = ((v ushr 16) and 0xFF).toByte()
        dst[offset + 3] = ((v ushr 24) and 0xFF).toByte()
    }

    private fun writeShortLe(dst: ByteArray, offset: Int, v: Short) {
        val i = v.toInt()
        dst[offset] = (i and 0xFF).toByte()
        dst[offset + 1] = ((i ushr 8) and 0xFF).toByte()
    }

    companion object {
        private const val HEADER_SIZE = 44
    }
}
