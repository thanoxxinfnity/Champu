# GDPR Compliance

Implement General Data Protection Regulation requirements for organizations that process personal data of EU/EEA residents, covering lawful processing, data subject rights, and technical safeguards.

## Key Principles and Legal Bases

```yaml
gdpr_principles:
  article_5:
    lawfulness_fairness_transparency:
      description: "Process data lawfully, fairly, and transparently"
      implementation:
        - Document legal basis for every processing activity
        - Provide clear privacy notices
        - No hidden or deceptive data collection

    purpose_limitation:
      description: "Collect for specified, explicit, and legitimate purposes"
      implementation:
        - Define purpose before collection
        - Do not repurpose data without new legal basis
        - Document all processing purposes in ROPA

    data_minimization:
      description: "Adequate, relevant, and limited to what is necessary"
      implementation:
        - Collect only required fields
        - Review data models for unnecessary fields
        - Remove optional fields that are not used

    accuracy:
      description: "Accurate and kept up to date"
      implementation:
        - Provide self-service profile editing
        - Implement data validation at point of entry
        - Schedule regular data quality reviews

    storage_limitation:
      description: "Kept no longer than necessary"
      implementation:
        - Define retention periods per data category
        - Automate deletion when retention expires
        - Document retention schedule

    integrity_and_confidentiality:
      description: "Appropriate security measures"
      implementation:
        - Encryption at rest and in transit
        - Access controls and audit logging
        - Pseudonymization where appropriate

    accountability:
      description: "Demonstrate compliance"
      implementation:
        - Maintain Records of Processing Activities
        - Conduct DPIAs for high-risk processing
        - Appoint DPO if required

legal_bases:
  article_6:
    consent: "Freely given, specific, informed, unambiguous"
    contract: "Necessary for performance of a contract"
    legal_obligation: "Required by EU or member state law"
    vital_interests: "Protect life of data subject or another person"
    public_interest: "Task carried out in public interest"
    legitimate_interest: "Legitimate interest not overridden by data subject rights"
```

## Data Mapping Template (Records of Processing Activities)

```yaml
# Record of Processing Activities (ROPA) - Article 30
processing_activity:
  name: "Customer Account Management"
  controller: "Example Corp, 123 Main St, Dublin, Ireland"
  dpo_contact: "dpo@example.com"
  purpose: "Manage customer accounts, provide services, handle billing"
  legal_basis: "Contract (Art. 6(1)(b))"
  categories_of_data_subjects:
    - Customers
    - Prospective customers
  categories_of_personal_data:
    - Name, email, phone number
    - Billing address
    - Payment information (tokenized)
    - Service usage data
    - Support ticket history
  special_categories: "None"
  recipients:
    - Payment processor (Stripe) - processor
    - Email service (SendGrid) - processor
    - Cloud hosting (AWS) - processor
  international_transfers:
    - Destination: United States
      Safeguard: "Standard Contractual Clauses (SCCs)"
      TIA_completed: true
  retention_period: "Account data retained for duration of contract + 7 years for legal obligations"
  security_measures:
    - AES-256 encryption at rest
    - TLS 1.3 in transit
    - Role-based access control
    - Audit logging of all access
  dpia_required: false
  last_reviewed: "2024-06-01"

# Template for each processing activity
processing_activity_template:
  name: ""
  controller: ""
  joint_controller: ""  # if applicable
  processor: ""  # if acting as processor
  dpo_contact: ""
  purpose: ""
  legal_basis: ""  # consent | contract | legal_obligation | vital_interests | public_interest | legitimate_interest
  legitimate_interest_assessment: ""  # if legitimate interest
  categories_of_data_subjects: []
  categories_of_personal_data: []
  special_categories: ""  # Art. 9 data
  recipients: []
  international_transfers: []
  retention_period: ""
  security_measures: []
  dpia_required: false
  date_added: ""
  last_reviewed: ""
```

## Consent Management Implementation

```python
"""
Consent management system implementing GDPR Article 7 requirements.
Consent must be freely given, specific, informed, and unambiguous.
"""
from datetime import datetime, timezone
from enum import Enum
import json
import hashlib


class ConsentPurpose(Enum):
    MARKETING_EMAIL = "marketing_email"
    MARKETING_SMS = "marketing_sms"
    ANALYTICS = "analytics"
    PERSONALIZATION = "personalization"
    THIRD_PARTY_SHARING = "third_party_sharing"
    PROFILING = "profiling"


class ConsentManager:
    def __init__(self, db):
        self.db = db

    def record_consent(self, user_id, purpose, granted, source,
                       privacy_policy_version, ip_address=None):
        """Record a consent decision with full audit trail."""
        consent_record = {
            "user_id": user_id,
            "purpose": purpose.value,
            "granted": granted,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": source,  # e.g., "web_signup", "preference_center", "cookie_banner"
            "privacy_policy_version": privacy_policy_version,
            "ip_address": ip_address,
            "withdrawal_timestamp": None,
        }
        # Store with immutable audit trail
        consent_record["record_hash"] = hashlib.sha256(
            json.dumps(consent_record, sort_keys=True).encode()
        ).hexdigest()
        self.db.consent_records.insert(consent_record)
        return consent_record

    def withdraw_consent(self, user_id, purpose):
        """Process consent withdrawal - must be as easy as giving consent."""
        record = self.record_consent(
            user_id=user_id,
            purpose=purpose,
            granted=False,
            source="withdrawal",
            privacy_policy_version="N/A",
        )
        # Trigger downstream actions
        self._notify_processors(user_id, purpose, "withdrawn")
        self._stop_processing(user_id, purpose)
        return record

    def get_consent_status(self, user_id, purpose):
        """Get current consent status for a specific purpose."""
        latest = self.db.consent_records.find_one(
            {"user_id": user_id, "purpose": purpose.value},
            sort=[("timestamp", -1)]
        )
        return latest["granted"] if latest else False

    def get_all_consents(self, user_id):
        """Get all consent records for a user (for DSAR response)."""
        return list(self.db.consent_records.find(
            {"user_id": user_id},
            sort=[("timestamp", -1)]
        ))

    def export_consent_proof(self, user_id, purpose):
        """Export verifiable consent proof for accountability."""
        records = list(self.db.consent_records.find(
            {"user_id": user_id, "purpose": purpose.value},
            sort=[("timestamp", 1)]
        ))
        return {
            "user_id": user_id,
            "purpose": purpose.value,
            "consent_history": records,
            "current_status": self.get_consent_status(user_id, purpose),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }

    def _notify_processors(self, user_id, purpose, action):
        """Notify downstream processors of consent change."""
        pass  # Implement webhook/API calls to processors

    def _stop_processing(self, user_id, purpose):
        """Immediately stop processing for withdrawn consent."""
        pass  # Implement processing halt logic
```

## Data Subject Access Request (DSAR) Procedures

```yaml
dsar_workflow:
  step_1_receive:
    actions:
      - Log the request with timestamp and channel received
      - Assign unique tracking ID
      - Acknowledge receipt within 3 business days
    identity_verification:
      - Verify identity before providing any data
      - Use existing authentication where possible
      - Request additional proof if necessary (but not excessive)
    sla: "Must respond within 30 days (extendable to 90 days for complex requests)"

  step_2_assess:
    actions:
      - Determine request type (access, rectification, erasure, portability, etc.)
      - Identify all systems containing the individual's data
      - Check for lawful grounds to refuse (legal obligations, etc.)
      - Assess if extension is needed (complex or numerous requests)

  step_3_collect:
    systems_to_search:
      - Primary application database
      - CRM system
      - Email marketing platform
      - Analytics systems
      - Customer support tickets
      - Backup systems (if practically retrievable)
      - Log files containing PII
      - Third-party processors (request from each)

  step_4_respond:
    access_request:
      - Provide copy of all personal data in commonly used electronic format
      - Include processing purposes, categories, recipients, retention periods
      - Include source of data if not collected from the individual
      - Include information about automated decision-making
    rectification_request:
      - Update data in all systems
      - Notify all recipients of the correction
    erasure_request:
      - Delete data from all active systems
      - Remove from backups where technically feasible
      - Notify all processors and recipients
      - Document what was deleted and any retained data with legal basis
    portability_request:
      - Provide data in structured, machine-readable format (JSON/CSV)
      - Include only data provided by the data subject
      - Transfer directly to another controller if requested and feasible

  step_5_close:
    actions:
      - Send response to data subject
      - Document the entire handling process
      - Archive DSAR record for accountability
      - Update data mapping if new data stores discovered
```

```python
"""DSAR automation - data collection across systems."""
import json
from datetime import datetime, timezone


class DSARProcessor:
    def __init__(self, data_sources):
        self.data_sources = data_sources  # Dict of system_name: DataSource

    def process_access_request(self, user_identifier):
        """Collect all personal data across registered systems."""
        collected_data = {
            "request_id": f"DSAR-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_subject": user_identifier,
            "systems": {},
        }

        for system_name, source in self.data_sources.items():
            try:
                data = source.extract_user_data(user_identifier)
                collected_data["systems"][system_name] = {
                    "status": "collected",
                    "record_count": len(data) if isinstance(data, list) else 1,
                    "data": data,
                }
            except Exception as e:
                collected_data["systems"][system_name] = {
                    "status": "error",
                    "error": str(e),
                }

        return collected_data

    def process_erasure_request(self, user_identifier):
        """Delete personal data across all systems (right to erasure)."""
        results = {
            "request_id": f"ERASE-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
            "data_subject": user_identifier,
            "systems": {},
        }

        for system_name, source in self.data_sources.items():
            try:
                deleted = source.delete_user_data(user_identifier)
                retained = source.get_retained_data(user_identifier)
                results["systems"][system_name] = {
           

…(the rest of this skill is left out)