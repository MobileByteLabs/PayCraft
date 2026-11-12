external interface PayCraftWebApi {
    fun email(): String?
    fun claimOffer(offerId: String): Boolean
}

external interface WebOfferView {
    val id: String
    val percentOff: Int
}
