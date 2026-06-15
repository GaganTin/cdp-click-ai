# Shared library for the Google Analytics landing DAGs.
#
# This package centralises the logic that used to be copy-pasted across
# build_landing_ga_reports.py and build_landing_ga_reports_trial_flow.py so the
# large DAGs can be broken down by purpose and so a single hybrid storage path
# (Azure Blob + PostgreSQL) can be maintained in one place.
